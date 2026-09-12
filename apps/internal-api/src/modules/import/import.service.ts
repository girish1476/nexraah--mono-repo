import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { DbExecutor } from '../../db/kysely';
import { AuditService } from '../audit';
import { ImportRepository, type BatchRow } from './import.repository';
import { readTable } from './csv';
import { missingDependencies, validate, type ImportSet } from './import.rules';

/** The wire shape of `docs/api/10-telematics-import.md`. */
export interface ImportBatchDto {
  id: string;
  set: ImportSet;
  fileName: string;
  fileHash: string;
  rows: number;
  rejected: number;
  actor: string;
  committedAt: string | null;
  status: 'DRY_RUN' | 'COMMITTED' | 'ABORTED';
  report?: unknown;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly importRepository: ImportRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `POST /admin/import/:set` — parse, validate, report. **Nothing is written**
   * to the domain tables; the only row this creates is the batch itself, which
   * is the record of the dry run and the payload a later commit will use.
   */
  async dryRun(
    set: ImportSet,
    file: { originalname: string; buffer: Buffer },
    actor: AuthenticatedUser,
  ): Promise<ImportBatchDto> {
    const existing = await this.importRepository.existingCounts();
    const missing = missingDependencies(set, existing);
    if (missing.length > 0) {
      // Part 12 §4 — name the dependency rather than failing vaguely. The
      // operator's next action is "import that set first", and the error is
      // the only place that can say so.
      throw new DomainException(
        409,
        'IMPORT_OUT_OF_ORDER',
        `The ${set} set depends on ${missing.join(' and ')}, which ${missing.length > 1 ? 'have' : 'has'} not been imported yet.`,
        { set, missing },
      );
    }

    const text = file.buffer.toString('utf8');
    const { header, rows } = readTable(text);
    if (header.length === 0) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'The file has no header row.');
    }

    const result = validate(set, rows);
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    const batch = await this.importRepository.transaction().execute((trx) =>
      this.importRepository.insertBatch(trx, {
        set_name: set,
        file_name: file.originalname,
        file_hash: fileHash,
        row_count: result.report.rowCount,
        rejected_count: result.report.rejects.length,
        actor_id: actor.userId,
        actor_name: actor.name,
        // A file that cannot reconcile is recorded as ABORTED at dry run, so
        // the commit route has nothing to decide and the history shows the
        // attempt rather than losing it.
        status: result.aborted ? 'ABORTED' : 'DRY_RUN',
        report: JSON.stringify(result.report),
        payload: JSON.stringify(result.accepted),
      }),
    );

    return this.toDto(batch as unknown as BatchRow, result.report);
  }

  /**
   * `POST /admin/import/:set/commit` — one transaction. A partial import is not
   * a state this system has, so every row lands or none does.
   */
  async commit(set: ImportSet, batchId: string, actor: AuthenticatedUser): Promise<ImportBatchDto> {
    return this.importRepository.transaction().execute(async (trx) => {
      const batch = await this.importRepository.findBatchForUpdate(trx, batchId);
      if (!batch) throw new DomainException(404, 'NOT_FOUND', `Unknown import batch: ${batchId}`);

      const row = batch as unknown as BatchRow;
      if (row.set_name !== set) {
        throw new DomainException(400, 'VALIDATION_ERROR', `Batch ${batchId} is a ${row.set_name} import, not ${set}.`);
      }
      if (row.status === 'COMMITTED') {
        throw new DomainException(409, 'ALREADY_COMMITTED', 'This batch has already been committed.');
      }
      if (row.status === 'ABORTED') {
        throw new DomainException(
          409,
          'IMPORT_ABORTED',
          'This file did not reconcile at dry run and cannot be committed. Correct it and upload again.',
        );
      }

      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>[];
      const written = await this.writeRows(trx, set, payload, row);

      const committed = await this.importRepository.markCommitted(trx, batchId);

      // Part 12 §2 — one audit event for the batch, carrying the file hash, so
      // a bad import is identifiable after the fact by the file that caused it.
      await this.auditService.record(trx, actor, {
        action: 'IMPORT',
        entityType: 'import_batches',
        entityId: batchId,
        after: { set, fileHash: row.file_hash, fileName: row.file_name, rowsWritten: written },
      });

      return this.toDto(committed as unknown as BatchRow);
    });
  }

  async history(): Promise<ImportBatchDto[]> {
    const rows = await this.importRepository.history();
    return (rows as unknown as BatchRow[]).map((r) => this.toDto(r));
  }

  /* ---- commit writes ---------------------------------------------------- */

  private async writeRows(
    trx: DbExecutor,
    set: ImportSet,
    payload: Record<string, unknown>[],
    batch: BatchRow,
  ): Promise<number> {
    if (set === 'clients') return this.writeClients(trx, payload, batch);
    if (set === 'vendors') return this.writeVendors(trx, payload, batch);

    /*
     * Opening balances stop here, deliberately and loudly.
     *
     * The dry run for this set is complete and does the thing part 12 actually
     * emphasises — reconciling to the supplied control total, and aborting the
     * whole file when it does not add up. What is missing is the other half:
     * an outstanding advance, an unbilled trip and an open invoice land in
     * three different tables, each needing fields (trip, UTR, value date;
     * client, invoice dates, line totals) that a `kind,reference,amount` line
     * cannot supply. No file format in the spec set carries them.
     *
     * Inventing a mapping would put fabricated money rows into the ledger on
     * day one, and silently committing nothing would report success for an
     * import that did not happen. Both are worse than saying so.
     */
    throw new DomainException(
      501,
      'IMPORT_SET_NOT_WRITABLE',
      'Opening balances validate and reconcile, but committing them needs a file format that carries the fields ' +
        'an advance, an unbilled trip and an invoice each require. That format is not yet specified, so this ' +
        'import cannot be written without inventing it.',
      { set, reconciled: true },
    );
  }

  private async writeClients(trx: DbExecutor, payload: Record<string, unknown>[], batch: BatchRow): Promise<number> {
    let written = 0;
    for (const rowData of payload) {
      const client = await this.importRepository.insertClient(trx, {
        code: rowData.code,
        name: rowData.name,
        billing_city: rowData.billingCity,
        engagement: rowData.engagement,
        gstin: rowData.gstin,
        contact: rowData.contact,
        phone: rowData.phone,
        email: rowData.email,
        agreement_no: rowData.agreementNo,
        credit_days: rowData.creditDays,
        service_level: rowData.serviceLevel,
      });
      written += 1;

      const lane = rowData.lane as
        | { origin: string; destination: string; truckType: string; ratePaise: number; validFrom: string; validTo: string | null }
        | null;
      if (!lane) continue;

      const rfqLane = await this.importRepository.syntheticRfqLane(
        trx,
        (client as { id: string }).id,
        lane,
        `IMPORT/${batch.id}`,
      );
      await this.importRepository.insertRateCardLane(trx, {
        client_id: (client as { id: string }).id,
        rfq_lane_id: rfqLane.id,
        origin: lane.origin,
        destination: lane.destination,
        truck_type: lane.truckType,
        rate: lane.ratePaise,
        valid_from: lane.validFrom,
        valid_to: lane.validTo,
      });
    }
    return written;
  }

  private async writeVendors(trx: DbExecutor, payload: Record<string, unknown>[], batch: BatchRow): Promise<number> {
    let written = 0;
    for (const rowData of payload) {
      await this.importRepository.insertVendor(trx, {
        code: rowData.code,
        legal_name: rowData.legalName,
        party_type: rowData.partyType,
        base_city: rowData.baseCity,
        phone: rowData.phone,
        gstin: rowData.gstin,
        pan: rowData.pan,
        advance_pct: rowData.advancePct,
        bank_account: rowData.bankAccount,
        ifsc: rowData.ifsc,
        account_holder: rowData.accountHolder,
        status: rowData.status,
        // Every imported row is identifiable as one, and traceable to the batch
        // that made it — part 12 §2, so a bad file is reversible after the fact.
        source: `IMPORT:${batch.id}`,
      });
      written += 1;
    }
    return written;
  }

  private toDto(row: BatchRow, report?: unknown): ImportBatchDto {
    const parsed = report ?? (typeof row.report === 'string' ? JSON.parse(row.report) : row.report);
    return {
      id: row.id,
      set: row.set_name,
      fileName: row.file_name,
      fileHash: row.file_hash,
      rows: row.row_count,
      rejected: row.rejected_count,
      actor: row.actor_name,
      committedAt: row.committed_at,
      status: row.status,
      report: parsed,
    };
  }
}

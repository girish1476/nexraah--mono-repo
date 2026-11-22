import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DomainException } from '../../common/domain-exception';
import { isUuid } from '../../common/ids';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { DbExecutor } from '../../db/kysely';
import { AuditService } from '../audit';
import { ImportRepository, type BatchRow } from './import.repository';
import { readTable } from './csv';
import { missingDependencies, validate, type BalanceContext, type ImportSet } from './import.rules';

/** Today in India, `YYYY-MM-DD` — ageing and "not in the future" are counted in the business's own day. */
export function indiaToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/** One opening balance as the console shows it. */
export interface OpeningBalanceDto {
  id: string;
  kind: 'ADVANCE' | 'UNBILLED' | 'INVOICE';
  reference: string;
  partyType: 'CLIENT' | 'VENDOR';
  partyId: string;
  partyName: string;
  amountPaise: number;
  dated: string;
  ageDays: number;
  status: 'OPEN' | 'SETTLED';
  settledAt: string | null;
  settledBy: string | null;
  settledNote: string | null;
  batchId: string;
}

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

    let ctx: BalanceContext | undefined;
    if (set === 'opening-balances') ctx = { ...(await this.importRepository.balanceContext()), today: indiaToday() };
    const result = validate(set, rows, ctx);
    if (set === 'vendors') await this.placeInBranches(result, rows);
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
   * Every transporter belongs to a branch (`vendors.branch_id` is required),
   * worked out from the base city exactly as onboarding does it. The import
   * never set it, so committing any transporter sheet failed on a real
   * database with "A required value is missing". Settled here, at the dry run,
   * so a town no branch serves is a line in the report before anything is
   * written — not a failed commit after.
   */
  private async placeInBranches(result: ReturnType<typeof validate>, rows: Record<string, string>[]) {
    const cache = new Map<string, { id: string; name: string }[]>();
    const kept: Record<string, unknown>[] = [];
    for (const row of result.accepted) {
      const city = String(row.baseCity ?? '').trim();
      const key = city.toLowerCase();
      if (!cache.has(key)) cache.set(key, await this.importRepository.branchesServing(city));
      const branches = cache.get(key)!;
      if (branches.length === 1) {
        kept.push({ ...row, branchId: branches[0].id });
        continue;
      }
      const at = rows.findIndex((r) => (r.code ?? '').trim() === row.code) + 2;
      result.report.rejects.push({
        row: at,
        reason:
          branches.length === 0
            ? `No branch serves "${city}" — add it to a branch's towns (Control → Branches), then upload again`
            : `${branches.length} branches serve "${city}" (${branches.map((b) => b.name).join(', ')}) — onboard this transporter in the console to choose one`,
      });
    }
    result.accepted = kept;
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

    return this.writeOpeningBalances(trx, payload, batch);
  }

  /**
   * Opening balances land in their own table, exactly as the file gave them —
   * not as made-up invoices, trips or payments, which need fields (GST lines,
   * truck and route, UTR and value date) an opening-balance line does not
   * carry. Each row keeps the batch that brought it in.
   */
  private async writeOpeningBalances(trx: DbExecutor, payload: Record<string, unknown>[], batch: BatchRow): Promise<number> {
    for (const rowData of payload) {
      await this.importRepository.insertOpeningBalance(trx, {
        kind: rowData.kind,
        reference: rowData.reference,
        client_id: rowData.clientId ?? null,
        vendor_id: rowData.vendorId ?? null,
        amount_paise: rowData.amountPaise,
        dated: rowData.dated,
        batch_id: batch.id,
      });
    }
    return payload.length;
  }

  /* ---- opening balances after go-live ------------------------------------ */

  /** `GET /opening-balances` — open first, oldest first. */
  async openingBalances(): Promise<OpeningBalanceDto[]> {
    const today = indiaToday();
    const rows = await this.importRepository.listOpeningBalances();
    return rows.map((r) => {
      const dated = typeof r.dated === 'string' ? r.dated.slice(0, 10) : new Date(r.dated as unknown as Date).toISOString().slice(0, 10);
      return {
        id: r.id,
        kind: r.kind as OpeningBalanceDto['kind'],
        reference: r.reference,
        partyType: r.vendor_id ? 'VENDOR' : 'CLIENT',
        partyId: (r.vendor_id ?? r.client_id)!,
        partyName: (r.vendor_id ? r.vendor_name : r.client_name) ?? '—',
        amountPaise: Number(r.amount_paise),
        dated,
        ageDays: Math.max(0, Math.round((Date.parse(today) - Date.parse(dated)) / 86_400_000)),
        status: r.status as OpeningBalanceDto['status'],
        settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
        settledBy: r.settled_by_name ?? null,
        settledNote: r.settled_note ?? null,
        batchId: r.batch_id,
      };
    });
  }

  /**
   * `POST /opening-balances/:id/settle` — the old invoice was paid, the trip
   * billed outside Nexraah, or the advance adjusted. Who may say so follows the
   * money: a client balance needs `receipt.record`, an advance needs
   * `payment.release`.
   */
  async settleOpeningBalance(id: string, note: string, actor: AuthenticatedUser): Promise<{ id: string; status: 'SETTLED' }> {
    const why = String(note ?? '').trim();
    if (why.length < 5) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'Say how it was settled — a receipt, cheque or adjustment reference — in a few words.');
    }
    return this.importRepository.transaction().execute(async (trx) => {
      const row = isUuid(id) ? await this.importRepository.findOpeningBalanceForUpdate(trx, id) : undefined;
      if (!row) throw new DomainException(404, 'NOT_FOUND', 'No such opening balance.');
      const needs = row.kind === 'ADVANCE' ? 'payment.release' : 'receipt.record';
      if (actor.permissions.get(needs) !== 'EDIT') {
        throw new DomainException(403, 'PERMISSION_DENIED', `Missing permission: ${needs}.`);
      }
      if (row.status === 'SETTLED') {
        throw new DomainException(409, 'ALREADY_SETTLED', 'This opening balance is already settled.');
      }
      await this.importRepository.settleOpeningBalance(trx, id, actor.userId, why);
      await this.auditService.record(trx, actor, {
        action: 'OPENING_BALANCE_SETTLED',
        entityType: 'opening_balances',
        entityId: id,
        before: { status: row.status },
        after: { status: 'SETTLED', note: why },
      });
      return { id, status: 'SETTLED' as const };
    });
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
        branch_id: rowData.branchId,
        phone: rowData.phone,
        gstin: rowData.gstin,
        pan: rowData.pan,
        // A blank cell is "use the default", not null — the column is NOT NULL.
        advance_pct: rowData.advancePct ?? 0,
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

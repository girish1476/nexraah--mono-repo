import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainException, assertReason } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { InvoicingRepository, type InvoiceListFilters } from './invoicing.repository';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import type { RecordReceiptDto } from './dto/record-receipt.dto';

const AGEING_BUCKETS = ['CURRENT', 'D0_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
type AgeingBucket = (typeof AGEING_BUCKETS)[number];

@Injectable()
export class InvoicingService {
  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Invoices -----------------------------------------------------------

  async list(filters: InvoiceListFilters) {
    const rows = await this.invoicingRepository.list(filters);
    if (rows.length === 0) return [];
    const links = await this.invoicingRepository.invoiceTripsForInvoices(rows.map((r) => r.id));
    const tripIdsByInvoice = new Map<string, string[]>();
    for (const link of links) {
      const list = tripIdsByInvoice.get(link.invoice_id) ?? [];
      list.push(link.trip_id);
      tripIdsByInvoice.set(link.invoice_id, list);
    }
    return rows.map((r) => this.invoiceDto(r, tripIdsByInvoice.get(r.id) ?? []));
  }

  async getById(id: string) {
    const row = await this.invoicingRepository.findById(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown invoice: ${id}`);

    const [trips, receipts, client] = await Promise.all([
      this.invoicingRepository.findTripsForInvoice(id),
      this.invoicingRepository.findReceiptsForInvoice(id),
      this.clientDto(row.clientId),
    ]);

    return {
      ...this.invoiceDto(row, trips.map((t) => t.id)),
      company: this.companyDetails(),
      client,
      trips,
      // `findReceiptsForInvoice` selects raw `receipts` columns only (no join),
      // so `invoiceCode`/`clientName` must be filled in from the invoice we
      // already have in scope — every receipt here belongs to this invoice.
      receipts: receipts.map((r) =>
        this.receiptRowDto({ ...r, invoiceCode: this.publicCode(row.code), clientName: row.clientName }),
      ),
    };
  }

  async create(dto: CreateInvoiceDto, actor: AuthenticatedUser) {
    const client = await this.invoicingRepository.findClientById(dto.clientId);
    if (!client) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${dto.clientId}`);

    const heads = this.normaliseHeads(dto);
    const { totalPaise, roundOffPaise } = this.computeTotals(heads);
    const tripIds = dto.tripIds ?? [];

    return this.invoicingRepository.transaction().execute(async (trx) => {
      if (tripIds.length > 0) {
        const trips = await this.invoicingRepository.findTripsByIdsForUpdate(trx, tripIds);
        const found = new Map(trips.map((t) => [t.id, t]));
        for (const tripId of tripIds) {
          const trip = found.get(tripId);
          if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
          if (trip.stage !== 'DELIVERED') {
            throw new DomainException(409, 'TRIP_NOT_DELIVERED', `Trip ${trip.code} has not been delivered yet.`);
          }
          if (trip.billed) {
            throw new DomainException(409, 'TRIP_ALREADY_BILLED', `Trip ${trip.code} is already on another invoice.`);
          }
        }
      }

      // `invoices.code` is NOT NULL — a draft carries a sentinel until
      // `generate()` consumes the real NEX-INV- series, mirroring how
      // `lorry_receipts.code` is drafted (trips.repository.ts upsertLrDraft).
      const id = randomUUID();
      const row = await this.invoicingRepository.insertInvoiceDraft(trx, {
        id,
        code: `DRAFT-${id}`,
        client_id: dto.clientId,
        invoice_date: dto.invoiceDate,
        due_date: dto.dueDate,
        freight: heads.freight,
        loading: heads.loading,
        unloading: heads.unloading,
        detention: heads.detention,
        other: heads.other,
        discount: heads.discount,
        round_off: roundOffPaise,
        total: totalPaise,
        notes: dto.notes ?? null,
      });
      await this.invoicingRepository.insertInvoiceTrips(trx, id, tripIds);

      await this.auditService.record(trx, actor, {
        action: 'INVOICE_CREATED',
        entityType: 'invoices',
        entityId: id,
        after: { clientId: dto.clientId, totalPaise, tripIds },
      });

      return this.invoiceDto(this.rawInvoiceToJoined(row, client.name), tripIds);
    });
  }

  async generate(id: string, actor: AuthenticatedUser) {
    return this.invoicingRepository.transaction().execute(async (trx) => {
      const row = await this.invoicingRepository.findByIdForUpdate(trx, id);
      if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown invoice: ${id}`);
      if (row.status !== 'DRAFT') {
        throw new DomainException(409, 'ALREADY_ISSUED', 'This invoice has already been issued.');
      }

      // Recomputed from the row's own stored heads — never trust a stored
      // total either, only the charge heads that produced it (NFR-09).
      const { totalPaise, roundOffPaise } = this.computeTotals({
        freight: row.freight,
        loading: row.loading,
        unloading: row.unloading,
        detention: row.detention,
        other: row.other,
        discount: row.discount,
      });

      // BR-14: consumed inside the issuing transaction.
      const code = await this.numberingService.issue(trx, 'INVOICE');
      const updated = await this.invoicingRepository.updateInvoice(trx, id, {
        code,
        status: 'ISSUED',
        total: totalPaise,
        round_off: roundOffPaise,
      });

      const links = await this.invoicingRepository.invoiceTripIds(id);
      const tripIds = links.map((l) => l.trip_id);
      await this.invoicingRepository.markTripsBilled(trx, tripIds);

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'invoices',
        entityId: id,
        after: { code, status: 'ISSUED' },
      });

      const client = await this.invoicingRepository.findClientById(updated.client_id);
      return this.invoiceDto(this.rawInvoiceToJoined(updated, client?.name ?? ''), tripIds);
    });
  }

  async cancel(id: string, dto: CancelInvoiceDto, actor: AuthenticatedUser) {
    assertReason(dto.reason);

    return this.invoicingRepository.transaction().execute(async (trx) => {
      const row = await this.invoicingRepository.findByIdForUpdate(trx, id);
      if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown invoice: ${id}`);
      if (row.status === 'CANCELLED') {
        throw new DomainException(409, 'ALREADY_CANCELLED', 'This invoice has already been cancelled.');
      }

      const updated = await this.invoicingRepository.updateInvoice(trx, id, {
        status: 'CANCELLED',
        cancel_reason: dto.reason,
      });

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'invoices',
        entityId: id,
        after: { status: 'CANCELLED', cancelReason: dto.reason },
      });

      const links = await this.invoicingRepository.invoiceTripIds(id);
      const client = await this.invoicingRepository.findClientById(updated.client_id);
      return this.invoiceDto(
        this.rawInvoiceToJoined(updated, client?.name ?? ''),
        links.map((l) => l.trip_id),
      );
    });
  }

  // ---- Receipts -------------------------------------------------------------

  async recordReceipt(dto: RecordReceiptDto, idempotencyKey: string, actor: AuthenticatedUser) {
    return this.invoicingRepository.transaction().execute(async (trx) => {
      const existing = await this.invoicingRepository.findReceiptByIdempotencyKeyForUpdate(trx, idempotencyKey);
      if (existing) {
        const existingInvoice = await this.invoicingRepository.findById(existing.invoice_id);
        return this.receiptRowDto({
          ...existing,
          invoiceCode: existingInvoice ? this.publicCode(existingInvoice.code) : null,
          clientName: existingInvoice?.clientName ?? '',
        });
      }

      const invoice = await this.invoicingRepository.findByIdForUpdate(trx, dto.invoiceId);
      if (!invoice) throw new DomainException(404, 'NOT_FOUND', `Unknown invoice: ${dto.invoiceId}`);
      if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
        throw new DomainException(
          409,
          'INVOICE_NOT_RECEIVABLE',
          `Invoice ${invoice.code} is ${invoice.status.toLowerCase()}; a receipt cannot be recorded against it.`,
        );
      }

      const balance = invoice.total - invoice.received;
      if (dto.amountPaise > balance) {
        throw new DomainException(
          400,
          'RECEIPT_EXCEEDS_BALANCE',
          `This receipt (₹${(dto.amountPaise / 100).toFixed(2)}) exceeds the outstanding balance (₹${(balance / 100).toFixed(2)}).`,
        );
      }

      const code = await this.numberingService.issue(trx, 'RECEIPT');
      const id = randomUUID();
      const receipt = await this.invoicingRepository.insertReceipt(trx, {
        id,
        code,
        invoice_id: dto.invoiceId,
        client_id: invoice.client_id,
        amount: dto.amountPaise,
        received_on: dto.receivedOn,
        mode: dto.mode,
        reference: dto.reference,
        remarks: dto.remarks ?? null,
        idempotency_key: idempotencyKey,
      });

      const newReceived = invoice.received + dto.amountPaise;
      const newStatus = newReceived >= invoice.total ? 'PAID' : 'PART_PAID';
      await this.invoicingRepository.updateInvoice(trx, dto.invoiceId, {
        received: newReceived,
        status: newStatus,
      });

      await this.auditService.record(trx, actor, {
        action: 'RECEIPT_RECORDED',
        entityType: 'receipts',
        entityId: id,
        after: { invoiceId: dto.invoiceId, amountPaise: dto.amountPaise, newStatus },
      });

      const clientName = (await this.invoicingRepository.findClientById(receipt.client_id))?.name ?? '';
      return this.receiptRowDto({ ...receipt, invoiceCode: this.publicCode(invoice.code), clientName });
    });
  }

  // ---- Receivables ----------------------------------------------------------

  async receivables(filters: { ageing?: string; client?: string }) {
    const rows = await this.invoicingRepository.receivablesRows(filters.client);
    const today = Date.now();

    const withBucket = rows.map((r) => ({
      invoiceId: r.id,
      invoiceCode: this.publicCode(r.code),
      clientName: r.clientName,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      totalPaise: r.totalPaise,
      receivedPaise: r.receivedPaise,
      balancePaise: r.totalPaise - r.receivedPaise,
      bucket: this.bucketOf(r.dueDate, today),
    }));

    const filtered = filters.ageing ? withBucket.filter((r) => r.bucket === filters.ageing) : withBucket;

    const buckets = AGEING_BUCKETS.map((bucket) => {
      const inBucket = withBucket.filter((r) => r.bucket === bucket);
      return {
        bucket,
        amountPaise: inBucket.reduce((sum, r) => sum + r.balancePaise, 0),
        count: inBucket.length,
      };
    });

    const receipts = await this.invoicingRepository.recentReceipts(filters.client);

    return {
      rows: filtered,
      buckets,
      receipts: receipts.map((r) => this.receiptRowDto(r)),
    };
  }

  // ---- Helpers ----------------------------------------------------------

  private normaliseHeads(dto: CreateInvoiceDto) {
    return {
      freight: dto.freightPaise,
      loading: dto.loadingPaise ?? 0,
      unloading: dto.unloadingPaise ?? 0,
      detention: dto.detentionPaise ?? 0,
      other: dto.otherPaise ?? 0,
      discount: dto.discountPaise ?? 0,
    };
  }

  /** NFR-09: rounding to the nearest rupee happens here, and only here. */
  private computeTotals(heads: {
    freight: number;
    loading: number;
    unloading: number;
    detention: number;
    other: number;
    discount: number;
  }) {
    const sum = heads.freight + heads.loading + heads.unloading + heads.detention + heads.other - heads.discount;
    const totalPaise = Math.round(sum / 100) * 100;
    return { totalPaise, roundOffPaise: totalPaise - sum };
  }

  private bucketOf(dueDate: string, todayMs: number): AgeingBucket {
    const daysPastDue = Math.floor((todayMs - new Date(dueDate).getTime()) / 86_400_000);
    if (daysPastDue <= 0) return 'CURRENT';
    if (daysPastDue <= 30) return 'D0_30';
    if (daysPastDue <= 60) return 'D31_60';
    if (daysPastDue <= 90) return 'D61_90';
    return 'D90_PLUS';
  }

  /** A `DRAFT-...` sentinel reads as `null` to every caller — see create(). */
  private publicCode(code: string): string | null {
    return code.startsWith('DRAFT-') ? null : code;
  }

  private companyDetails() {
    // Reserved for `config.company` (patch-config.dto.ts) once a company
    // profile screen ships — every field the frontend's CompanyDetails type
    // needs (`name`, `gstin`, `pan`, `cin`, `address`, `bank`) already lives
    // in config.company, mirroring how PaymentsService reads ConfigRepository.
    return { name: '', gstin: '', pan: '', cin: '', address: '', bank: '' };
  }

  private async clientDto(clientId: string) {
    const row = await this.invoicingRepository.findClientById(clientId);
    if (!row) return null;
    const outstandingPaise = await this.invoicingRepository.clientOutstandingPaise(clientId);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      billingCity: row.billing_city,
      gstin: row.gstin,
      contact: row.contact,
      phone: row.phone,
      email: row.email,
      engagement: row.engagement,
      agreementNo: row.agreement_no,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      agreementAttachmentId: row.agreement_attachment_id,
      creditDays: row.credit_days,
      serviceLevel: row.service_level,
      status: row.status,
      outstandingPaise,
    };
  }

  private receiptRowDto(row: {
    id: string;
    code: string;
    invoiceId?: string;
    invoice_id?: string;
    invoiceCode?: string | null;
    clientId?: string;
    client_id?: string;
    clientName?: string;
    amountPaise?: number;
    amount?: number;
    receivedOn?: string;
    received_on?: string;
    mode: string;
    reference: string | null;
    remarks: string | null;
  }) {
    return {
      id: row.id,
      code: row.code,
      invoiceId: row.invoiceId ?? row.invoice_id ?? '',
      invoiceCode: row.invoiceCode ?? null,
      clientId: row.clientId ?? row.client_id ?? '',
      clientName: row.clientName ?? '',
      amountPaise: row.amountPaise ?? row.amount ?? 0,
      receivedOn: row.receivedOn ?? row.received_on ?? '',
      mode: row.mode,
      reference: row.reference ?? '',
      remarks: row.remarks ?? '',
    };
  }

  /** Turns an `updateInvoice`/`insertInvoiceDraft` raw row into the joined shape `invoiceDto` expects. */
  private rawInvoiceToJoined(
    row: {
      id: string;
      code: string;
      client_id: string;
      invoice_date: string;
      due_date: string;
      freight: number;
      loading: number;
      unloading: number;
      detention: number;
      other: number;
      discount: number;
      round_off: number;
      total: number;
      received: number;
      tax_mechanism: string;
      status: string;
      cancel_reason: string | null;
      notes: string | null;
    },
    clientName: string,
  ) {
    return {
      id: row.id,
      code: row.code,
      clientId: row.client_id,
      clientName,
      invoiceDate: row.invoice_date,
      dueDate: row.due_date,
      freightPaise: row.freight,
      loadingPaise: row.loading,
      unloadingPaise: row.unloading,
      detentionPaise: row.detention,
      otherPaise: row.other,
      discountPaise: row.discount,
      roundOffPaise: row.round_off,
      totalPaise: row.total,
      receivedPaise: row.received,
      taxMechanism: row.tax_mechanism,
      status: row.status,
      cancelReason: row.cancel_reason,
      notes: row.notes,
    };
  }

  private invoiceDto(
    row: {
      id: string;
      code: string;
      clientId: string;
      clientName: string;
      invoiceDate: string;
      dueDate: string;
      freightPaise: number;
      loadingPaise: number;
      unloadingPaise: number;
      detentionPaise: number;
      otherPaise: number;
      discountPaise: number;
      roundOffPaise: number;
      totalPaise: number;
      receivedPaise: number;
      taxMechanism: string;
      status: string;
      cancelReason: string | null;
      notes: string | null;
    },
    tripIds: string[],
  ) {
    return {
      id: row.id,
      code: this.publicCode(row.code),
      clientId: row.clientId,
      clientName: row.clientName,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      tripIds,
      freightPaise: row.freightPaise,
      loadingPaise: row.loadingPaise,
      unloadingPaise: row.unloadingPaise,
      detentionPaise: row.detentionPaise,
      otherPaise: row.otherPaise,
      discountPaise: row.discountPaise,
      roundOffPaise: row.roundOffPaise,
      totalPaise: row.totalPaise,
      receivedPaise: row.receivedPaise,
      taxMechanism: row.taxMechanism,
      status: row.status,
      cancelReason: row.cancelReason,
      notes: row.notes ?? '',
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import type { JournalInvoice, JournalPayment, JournalReceipt } from '../../common/accounting-journal';

export interface ReleasedPayment extends JournalPayment {
  id: string;
}

/** What the accounting export and the bank-statement check read. Amounts in paise. */
@Injectable()
export class AccountingRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  async invoices(from: string, to: string): Promise<JournalInvoice[]> {
    const rows = await sql<{ code: string; client_name: string; invoice_date: string; total: string; status: string }>`
      select i.code, c.name as client_name, to_char(i.invoice_date, 'YYYY-MM-DD') as invoice_date, i.total, i.status
        from invoices i join clients c on c.id = i.client_id
       where i.invoice_date between ${from}::date and ${to}::date`.execute(this.db);
    return rows.rows.map((r) => ({
      code: r.code,
      clientName: r.client_name,
      invoiceDate: r.invoice_date,
      totalPaise: Number(r.total),
      status: r.status,
    }));
  }

  async receipts(from: string, to: string): Promise<JournalReceipt[]> {
    const rows = await sql<{ code: string; invoice_code: string; client_name: string; received_on: string; amount: string; mode: string | null; reference: string | null }>`
      select r.code, i.code as invoice_code, c.name as client_name, to_char(r.received_on, 'YYYY-MM-DD') as received_on,
             r.amount, r.mode, r.reference
        from receipts r join invoices i on i.id = r.invoice_id join clients c on c.id = r.client_id
       where r.received_on between ${from}::date and ${to}::date`.execute(this.db);
    return rows.rows.map((r) => ({
      code: r.code,
      invoiceCode: r.invoice_code,
      clientName: r.client_name,
      receivedOn: r.received_on,
      amountPaise: Number(r.amount),
      mode: r.mode,
      reference: r.reference,
    }));
  }

  /** Every payment released to a transporter, newest first — or only those valued between two days. */
  async releasedPayments(from?: string, to?: string): Promise<ReleasedPayment[]> {
    const within = from && to ? sql`where p.value_date between ${from}::date and ${to}::date` : sql``;
    // An advance is recorded against the indent; its trip is the one raised from that indent.
    const rows = await sql<{ id: string; kind: string; trip_code: string | null; vendor_name: string | null; utr: string; net: string; value_date: string; released_at: string }>`
      select p.id, p.kind, t.code as trip_code, v.legal_name as vendor_name, p.utr, p.net,
             to_char(p.value_date, 'YYYY-MM-DD') as value_date, p.released_at
        from payments p
        left join trips t on t.id = coalesce(p.trip_id, (select t2.id from trips t2 where t2.indent_id = p.indent_id order by t2.created_at desc limit 1))
        left join vendors v on v.id = t.vendor_id
        ${within}
       order by p.released_at desc`.execute(this.db);
    return rows.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      tripCode: r.trip_code,
      vendorName: r.vendor_name,
      utr: r.utr,
      netPaise: Number(r.net),
      valueDate: r.value_date,
      releasedAt: new Date(r.released_at).toISOString(),
    }));
  }
}

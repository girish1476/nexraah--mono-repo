import { CompanyDetails } from '@/app/admin/types';
import { Client } from '@/app/clients/types';
import { TripListRow } from '@/app/trips/types';

/**
 * Invoicing — part 08. Our invoice to the client.
 *
 * There is no GST field anywhere on this type by design (BR-15, D-06, D-26).
 * The nil tax columns exist in the database so a later forward-charge entity
 * is a configuration change rather than a migration; nothing writes them and
 * nothing renders them.
 */

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PART_PAID' | 'PAID' | 'CANCELLED';

/**
 * What `POST /invoices` accepts — the charge heads, never the total. Rounding
 * and the total are computed on the server (NFR-09) and `CreateInvoiceDto`
 * refuses a body that carries them.
 */
export interface InvoiceDraft {
  clientId: string;
  invoiceDate: string;
  dueDate: string;
  tripIds?: string[];
  freightPaise: number;
  loadingPaise?: number;
  unloadingPaise?: number;
  detentionPaise?: number;
  otherPaise?: number;
  discountPaise?: number;
  notes?: string;
}

export interface Invoice {
  id: string;
  /** Null until `generate` consumes the NEX-INV- series. */
  code: string | null;
  clientId: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string;
  tripIds: string[];
  freightPaise: number;
  loadingPaise: number;
  unloadingPaise: number;
  detentionPaise: number;
  otherPaise: number;
  discountPaise: number;
  /** NFR-09 — rupee rounding happens here and only here. */
  roundOffPaise: number;
  totalPaise: number;
  receivedPaise: number;
  taxMechanism: 'REVERSE_CHARGE';
  status: InvoiceStatus;
  cancelReason: string | null;
  notes: string;
}

export interface InvoiceDetail extends Invoice {
  company: CompanyDetails;
  client: Client | null;
  trips: TripListRow[];
  receipts: Receipt[];
}

export interface Receipt {
  id: string;
  code: string;
  invoiceId: string;
  invoiceCode: string | null;
  clientId: string;
  clientName: string;
  amountPaise: number;
  receivedOn: string;
  mode: string;
  /** UTR or cheque number — mandatory. */
  reference: string;
  remarks: string;
}

export type AgeingBucket = 'CURRENT' | 'D0_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export interface ReceivablesRow {
  invoiceId: string;
  invoiceCode: string | null;
  clientName: string;
  invoiceDate: string;
  dueDate: string;
  totalPaise: number;
  receivedPaise: number;
  balancePaise: number;
  bucket: AgeingBucket;
}

export interface ReceivablesResponse {
  rows: ReceivablesRow[];
  buckets: { bucket: AgeingBucket; amountPaise: number; count: number }[];
  receipts: Receipt[];
}

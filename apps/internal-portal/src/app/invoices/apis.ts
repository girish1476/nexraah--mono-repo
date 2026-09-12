import { idempotent, request } from '@/apis';
import { Invoice, InvoiceDetail, InvoiceDraft, InvoiceStatus, Receipt, ReceivablesResponse } from './types';

/** GET /invoices?q=&status=&from=&to= */
export function listInvoices(params: { q?: string; status?: InvoiceStatus; from?: string; to?: string } = {}) {
  return request<Invoice[]>({ url: '/invoices', method: 'GET', params });
}

/** GET /invoices/:id — includes the company block, the trips and the receipts. */
export function getInvoice(id: string) {
  return request<InvoiceDetail>({ url: `/invoices/${id}`, method: 'GET' });
}

/** POST /invoices · `invoice.create` — creates the draft. */
export function createInvoice(body: InvoiceDraft) {
  return request<Invoice>({ url: '/invoices', method: 'POST', data: body });
}

/**
 * POST /invoices/:id/generate · `invoice.create`
 * Consumes the NEX-INV- series inside the issuing transaction → ISSUED.
 */
export function generateInvoice(id: string) {
  return request<Invoice>({ url: `/invoices/${id}/generate`, method: 'POST' });
}

/** POST /invoices/:id/cancel  { reason } — never deletes; the number is kept. */
export function cancelInvoice(id: string, reason: string) {
  return request<Invoice>({ url: `/invoices/${id}/cancel`, method: 'POST', data: { reason } });
}

/**
 * POST /receipts · `receipt.record`
 * Full receipt closes the invoice; a lesser amount part-pays it and the
 * balance stays in the ageing (BR-16). `Idempotency-Key` is mandatory — a
 * double-submitted receipt must not double-credit the invoice, the same
 * guarantee `payments/apis.ts` gives advance/balance release.
 */
export function recordReceipt(
  key: string,
  body: {
    invoiceId: string;
    amountPaise: number;
    receivedOn: string;
    mode: string;
    reference: string;
    remarks?: string;
  },
) {
  return idempotent<Receipt>(key, { url: '/receipts', method: 'POST', data: body });
}

/** GET /receivables?ageing=&client= */
export function getReceivables(params: { ageing?: string; client?: string } = {}) {
  return request<ReceivablesResponse>({ url: '/receivables', method: 'GET', params });
}

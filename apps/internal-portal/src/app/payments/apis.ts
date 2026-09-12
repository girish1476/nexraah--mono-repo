import { idempotent, request } from '@/apis';
import {
  AdvanceDetail,
  AdvanceQueueRow,
  BalanceDetail,
  BalanceQueueRow,
  Payment,
  PaymentCapture,
  VendorBill,
} from './types';

/**
 * Every endpoint here requires `payment.release`, which is FINANCE only and
 * not grantable to a second role (BR-40). A non-finance role gets no button
 * *and* a 403 — the two are independent.
 */

/* ---- advance — BR-07, BR-08, BR-58 -------------------------------------- */

export function listAdvanceQueue(params: { status?: string } = {}) {
  return request<AdvanceQueueRow[]>({ url: '/payments/advance', method: 'GET', params });
}

/** GET /payments/advance/:indentId — computed amount and the blocking checklist. */
export function getAdvance(indentId: string) {
  return request<AdvanceDetail>({ url: `/payments/advance/${indentId}`, method: 'GET' });
}

/**
 * POST /payments/advance/:indentId
 * `Idempotency-Key` is mandatory: a double-submitted advance is the one
 * mistake this system must not make. 409 ADVANCE_BLOCKED carries the unmet
 * list by name — the frontend renders it, never computes it.
 */
export function releaseAdvance(indentId: string, key: string, capture: PaymentCapture) {
  return idempotent<Payment>(key, {
    url: `/payments/advance/${indentId}`,
    method: 'POST',
    data: capture,
  });
}

/* ---- balance — BR-10, BR-11, BR-24, BR-25 ------------------------------- */

export function listBalanceQueue(params: { status?: string } = {}) {
  return request<BalanceQueueRow[]>({ url: '/payments/balance', method: 'GET', params });
}

/** GET /payments/balance/:tripId — the full deduction breakdown. */
export function getBalance(tripId: string) {
  return request<BalanceDetail>({ url: `/payments/balance/${tripId}`, method: 'GET' });
}

/** POST /payments/balance/:tripId — 409 BALANCE_BLOCKED or 409 POD_FORFEITED. */
export function releaseBalance(tripId: string, key: string, capture: PaymentCapture) {
  return idempotent<Payment>(key, {
    url: `/payments/balance/${tripId}`,
    method: 'POST',
    data: capture,
  });
}

/* ---- transporter bills — BR-53 ------------------------------------------ */

export function listBills(params: { status?: string } = {}) {
  return request<VendorBill[]>({ url: '/payments/bills', method: 'GET', params });
}

export function getBill(id: string) {
  return request<VendorBill>({ url: `/payments/bills/${id}`, method: 'GET' });
}

/**
 * POST /payments/bills/:id/accept
 * Accepting a bill releases the balance for its trip — the same five
 * mandatory payment fields and the same `Idempotency-Key` requirement apply
 * as a direct balance release. `atTheirFigure` releases at the transporter's
 * number instead of ours and requires a reason. Finance owns that decision
 * under BR-40 — it raises no approval.
 */
export function acceptBill(
  id: string,
  key: string,
  body: PaymentCapture & { atTheirFigure?: boolean; reason?: string },
) {
  return idempotent<{ id: string; status: VendorBill['status']; payment: Payment }>(key, {
    url: `/payments/bills/${id}/accept`,
    method: 'POST',
    data: body,
  });
}

/** POST /payments/bills/:id/query — notifies the transporter; the bill stays open. */
export function queryBill(id: string, note: string) {
  return request<VendorBill>({ url: `/payments/bills/${id}/query`, method: 'POST', data: { note } });
}

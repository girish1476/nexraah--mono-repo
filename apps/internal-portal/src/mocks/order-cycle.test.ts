import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { db } from './db';
import type { RoleCode } from '../lib/permissions';

/**
 * The order cycle the operations team works to (30 Sep 2026), driven through
 * the fixture's own adapter:
 *
 *   vehicle allocated → on the way to the loading point → reached it → loaded
 *   → advance documents uploaded → verified → advance paid → on the road (by
 *   itself) → reached the unloading point → unloaded → E-POD → invoiceable
 *
 * The complaint behind it: "after the advance is uploaded, verified and paid
 * the order does not move to the tracking stage". It does now.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown, headers: Record<string, string> = {}) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers } as never);
  return (res.data as { data: any }).data;
};

const failure = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  try {
    await call(role, method, url, data);
  } catch (e) {
    return String((e as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code ?? (e as Error).message);
  }
  return null;
};

// i-4462: Apex Ceramics, OPEN, no quotes. v-2301 is an ACTIVE transporter.
const INDENT = 'i-4462';

describe('the order cycle', () => {
  it('moves from allocation to unloaded and invoiceable without getting stuck', async () => {
    const withQuote = await call('OPS', 'POST', `/indents/${INDENT}/quotes`, { vendorId: 'v-2301', amountPaise: 4_400_000 });
    const quote = withQuote.quotes.find((q: any) => q.vendorId === 'v-2301' && q.status === 'SUBMITTED');
    await call('OPS', 'POST', `/indents/${INDENT}/award`, { quoteId: quote.id });
    await call('OPS', 'POST', `/indents/${INDENT}/placement`, { vehicleNo: 'MH 15 AB 1234', driverPhone: '9876543210' });
    const trip = db.trips.find((t: any) => t.indentId === INDENT && t.stage === 'OPEN')!;
    expect(trip).toBeTruthy();

    // Loaded comes after reaching the loading point, never before.
    expect(await failure('OPS', 'POST', `/trips/${trip.id}/tracking`, { kind: 'LOADED' })).toBe('NOT_AT_LOADING_POINT');
    await call('OPS', 'POST', `/trips/${trip.id}/tracking`, { kind: 'UPDATE', location: 'Nashik bypass' });
    await call('OPS', 'POST', `/trips/${trip.id}/tracking`, { kind: 'REACHED_LOADING' });

    // Not loaded yet: the truck cannot be sent off.
    expect(await failure('OPS', 'POST', `/trips/${trip.id}/depart`)).toBe('ADVANCE_DOCS_NOT_UPLOADED');
    await call('OPS', 'POST', `/trips/${trip.id}/tracking`, { kind: 'LOADED' });
    expect(trip.loadingCompletedAt).toBeTruthy();

    // The advance documents, uploaded and verified.
    for (const kind of db.config.advance_document_set as string[]) {
      // The uploader attaches the file only; Compliance types the details as they verify.
      await call('OPS', 'POST', `/trips/${trip.id}/documents/${kind}`, { attachmentId: `att-${kind}` });
      await call(
        'COMPLIANCE',
        'POST',
        `/trips/${trip.id}/documents/${kind}/verify`,
        kind === 'EWAY_BILL' ? { keyedValues: { vehicleNo: 'MH15AB1234', validTill: '2099-01-01' } } : {},
      );
    }
    // The Details page names who uploaded each document and who verified it.
    const docs = await call('OPS', 'GET', `/trips/${trip.id}/documents`);
    const eway = docs.find((d: any) => d.kind === 'EWAY_BILL');
    expect(eway.uploadedBy).toBeTruthy();
    expect(eway.verifiedBy).toBeTruthy();
    expect(eway.uploadedBy).not.toBe(eway.verifiedBy);

    // Advance paid → the order moves to tracking by itself.
    await call(
      'FINANCE',
      'POST',
      `/payments/advance/${INDENT}`,
      { mode: 'NEFT', transferType: 'VENDOR_ACCOUNT', remittingAccount: 'HDFC 0001', utr: 'UTR123456', valueDate: '2026-10-01' },
      { 'idempotency-key': `cycle-${Date.now()}` },
    );
    expect(trip.stage).toBe('IN_TRANSIT');
    const order = await call('OPS', 'GET', `/orders/${INDENT}`);
    expect(order.status).toBe('TRACKING');

    // In transit: a position update carries how the truck is doing.
    await call('OPS', 'POST', `/trips/${trip.id}/tracking`, { kind: 'UPDATE', location: 'Nagpur', status: 'BREAKDOWN', note: 'Clutch' });
    // The e-way bill runs out before unloading: it is extended, and only forward.
    expect(await failure('OPS', 'POST', `/trips/${trip.id}/eway-extension`, { validTill: '2098-01-01' })).toBe('VALIDATION_ERROR');
    const extended = await call('OPS', 'POST', `/trips/${trip.id}/eway-extension`, {
      validTill: '2099-02-01',
      ewayNo: '1812-EXT-01',
      reason: 'Breakdown near Nagpur',
    });
    expect(extended.eway).toEqual({ ewayNo: '1812-EXT-01', validTill: '2099-02-01', uploaded: true });
    expect(extended.updates.find((u: any) => u.kind === 'UPDATE' && u.location === 'Nagpur').status).toBe('BREAKDOWN');
    expect(extended.updates.at(-1).note).toMatch(/E-way bill extended to 2099-02-01 \(was 2099-01-01\) — Breakdown near Nagpur/);

    // Billing can start while the truck is on the road.
    const invoiceable = await call('FINANCE', 'GET', '/trips?invoiceable=1');
    expect(invoiceable.some((t: any) => t.id === trip.id)).toBe(true);

    // No proof of delivery before unloading.
    expect(await failure('OPS', 'POST', `/pod/${trip.id}/epod`, { attachmentIds: ['att-x'] })).toBe('NOT_DELIVERED');

    await call('OPS', 'POST', `/trips/${trip.id}/tracking`, { kind: 'REACHED' });
    await call('OPS', 'POST', `/trips/${trip.id}/deliver`, {});
    expect(trip.stage).toBe('DELIVERED');

    const receipt = await call('OPS', 'POST', `/pod/${trip.id}/epod`, { attachmentIds: ['att-epod-1'] });
    expect(receipt.podKind).toBe('EPOD');
    expect(trip.podStatus).toBe('RECEIVED');

    const sheet = await call('OPS', 'GET', `/trips/${trip.id}/tracking`);
    expect(sheet.updates.map((u: any) => u.kind)).toEqual([
      'UPDATE',
      'REACHED_LOADING',
      'LOADED',
      'DEPARTED',
      'UPDATE',
      'EWAY_EXTENDED',
      'REACHED',
      'UNLOADED',
    ]);
    // Unloaded: the e-way bill no longer needs extending.
    expect(await failure('OPS', 'POST', `/trips/${trip.id}/eway-extension`, { validTill: '2099-03-01' })).toBe('TRACKING_CLOSED');
  }, 20_000);
});

describe('deleting a duplicate rate', () => {
  it('is Leadership’s or an administrator’s, and takes the lane off the rate card', async () => {
    const clientId = Object.keys(db.rateCards).find((c) => (db.rateCards[c] ?? []).length > 0)!;
    const lane = db.rateCards[clientId][0];
    const reason = 'Duplicate entered twice by mistake';
    expect(await failure('FINANCE', 'DELETE', `/clients/${clientId}/rate-card/${lane.id}`, { reason })).toBe('PERMISSION_DENIED');
    expect(await failure('LEADERSHIP', 'DELETE', `/clients/${clientId}/rate-card/${lane.id}`, { reason: 'dup' })).toBe('REASON_TOO_SHORT');
    await call('LEADERSHIP', 'DELETE', `/clients/${clientId}/rate-card/${lane.id}`, { reason });
    const card = await call('OPS', 'GET', `/clients/${clientId}/rate-card`);
    expect(card.some((l: any) => l.id === lane.id)).toBe(false);
  });
});

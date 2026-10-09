import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { db } from './db';
import type { RoleCode } from '../lib/permissions';

/**
 * Putting a mistake right, anywhere in the flow (8 Oct 2026): a load request,
 * a quote, an agreed rate, a proposal still waiting, and one that was turned
 * down. Each correction takes effect at once and keeps its reason.
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

describe('correcting a load request', () => {
  it('changes the details at once, on the load and its trip, and keeps the reason', async () => {
    const before = await call('OPS', 'GET', `/indents/${INDENT}`);
    expect(await failure('OPS', 'PATCH', `/indents/${INDENT}/details`, { weightTn: before.weightTn + 2 })).toBe('VALIDATION_ERROR');
    expect(await failure('FINANCE', 'PATCH', `/indents/${INDENT}/details`, { weightTn: 9, reason: 'typo in the weight' })).toBe('FORBIDDEN');
    expect(await failure('OPS', 'PATCH', `/indents/${INDENT}/details`, { weightTn: before.weightTn, reason: 'no change at all' })).toBe('NOTHING_CHANGED');

    const after = await call('OPS', 'PATCH', `/indents/${INDENT}/details`, {
      weightTn: before.weightTn + 2,
      sellRatePaise: before.sellRatePaise + 50_000,
      material: 'Vitrified tiles (corrected)',
      reason: 'Weight and freight were typed from the wrong mail',
    });
    expect(after.weightTn).toBe(before.weightTn + 2);
    expect(after.sellRatePaise).toBe(before.sellRatePaise + 50_000);
    expect(after.material).toBe('Vitrified tiles (corrected)');

    const order = await call('OPS', 'GET', `/orders/${INDENT}`);
    const note = order.comments.at(-1).body as string;
    expect(note).toMatch(/Load request corrected/);
    expect(note).toMatch(/Reason: Weight and freight were typed from the wrong mail/);
  }, 20_000);
});

describe('correcting a quote', () => {
  it('fixes the amount before and after the award, and removes one entered by mistake', async () => {
    const withQuote = await call('OPS', 'POST', `/indents/${INDENT}/quotes`, { vendorId: 'v-2301', amountPaise: 4_400_000 });
    const quote = withQuote.quotes.find((q: any) => q.vendorId === 'v-2301');

    // Before the award: the amount is put right.
    expect(await failure('OPS', 'PATCH', `/indents/${INDENT}/quotes/${quote.id}`, { amountPaise: 4_300_000 })).toBe('VALIDATION_ERROR');
    const fixed = await call('OPS', 'PATCH', `/indents/${INDENT}/quotes/${quote.id}`, { amountPaise: 4_300_000, reason: 'One zero too many' });
    expect(fixed.quotes.find((q: any) => q.id === quote.id).amountPaise).toBe(4_300_000);

    // Entered for the wrong transporter altogether: removed, and can be entered again.
    await call('OPS', 'DELETE', `/indents/${INDENT}/quotes/${quote.id}`, { reason: 'Entered on the wrong load' });
    const again = await call('OPS', 'POST', `/indents/${INDENT}/quotes`, { vendorId: 'v-2301', amountPaise: 4_350_000 });
    const q2 = again.quotes.find((q: any) => q.vendorId === 'v-2301');
    expect(again.quotes).toHaveLength(1);

    // After the award: correcting the amount moves the buy rate on the load and the trip.
    await call('OPS', 'POST', `/indents/${INDENT}/award`, { quoteId: q2.id });
    const awarded = await call('OPS', 'PATCH', `/indents/${INDENT}/quotes/${q2.id}`, { amountPaise: 4_200_000, reason: 'Transporter confirmed the lower rate' });
    expect(awarded.buyRatePaise).toBe(4_200_000);
    const trip = db.trips.find((t: any) => t.indentId === INDENT)!;
    expect(trip.buyRatePaise).toBe(4_200_000);
    // An awarded quote is corrected, not removed.
    expect(await failure('OPS', 'DELETE', `/indents/${INDENT}/quotes/${q2.id}`, { reason: 'trying to remove it' })).toBe('QUOTE_CLOSED');
  }, 30_000);
});

describe('correcting rates', () => {
  const clientId = Object.keys(db.rateCards).find((c) => (db.rateCards[c] ?? []).length > 0)!;
  const proposal = (over: Record<string, unknown> = {}) => ({
    origin: 'Hosur',
    destination: 'Madurai',
    truckType: '32 ft SXL',
    ratePaise: 5_000_000,
    transitDays: 2,
    validFrom: '2026-10-01',
    reason: 'Agreed with the client by mail on 6 October.',
    approvalMailSubject: 'Hosur–Madurai rate approval',
    ...over,
  });

  it('puts an agreed rate right at once, with a reason', async () => {
    const lane = db.rateCards[clientId][0];
    expect(await failure('BD', 'PATCH', `/clients/${clientId}/rate-card/${lane.id}`, { ratePaise: lane.ratePaise + 100 })).toBe('REASON_TOO_SHORT');
    expect(await failure('OPS', 'PATCH', `/clients/${clientId}/rate-card/${lane.id}`, { ratePaise: 1, reason: 'not allowed to do this' })).toBe('PERMISSION_DENIED');
    const fixed = await call('BD', 'PATCH', `/clients/${clientId}/rate-card/${lane.id}`, {
      ratePaise: lane.ratePaise + 10_000,
      transitDays: lane.transitDays + 1,
      reason: 'Rate typed ₹100 short of the agreement',
    });
    expect(fixed.ratePaise).toBe(lane.ratePaise);
    expect(fixed.correctionReason).toBe('Rate typed ₹100 short of the agreement');
    const card = await call('OPS', 'GET', `/clients/${clientId}/rate-card`);
    expect(card.find((l: any) => l.id === lane.id).ratePaise).toBe(fixed.ratePaise);
  });

  it('edits a proposal that is still waiting, and it approves with the corrected figures', async () => {
    const raised = await call('BD', 'POST', `/clients/${clientId}/rate-card`, proposal());
    const approvalId = raised.approval.id;
    const edited = await call('BD', 'PATCH', `/clients/${clientId}/rate-card/pending/${approvalId}`, { ratePaise: 5_250_000, transitDays: 3 });
    expect(edited.ratePaise).toBe(5_250_000);
    await call('LEADERSHIP', 'POST', `/approvals/${approvalId}/approve`);
    const card = await call('OPS', 'GET', `/clients/${clientId}/rate-card`);
    const lane = card.find((l: any) => l.origin === 'Hosur' && l.destination === 'Madurai');
    expect(lane.ratePaise).toBe(5_250_000);
    expect(lane.transitDays).toBe(3);
  });

  it('a rejected proposal is kept to correct and send again — and then approves', async () => {
    const raised = await call('BD', 'POST', `/clients/${clientId}/rate-card`, proposal({ origin: 'Salem', destination: 'Erode', ratePaise: 9_900_000 }));
    await call('LEADERSHIP', 'POST', `/approvals/${raised.approval.id}/reject`, { note: 'Rate is ten times too high' });
    const rejected = await call('BD', 'GET', `/clients/${clientId}/rate-card/rejected`);
    const mine = rejected.find((r: any) => r.approvalId === raised.approval.id);
    expect(mine.note).toBe('Rate is ten times too high');
    expect(mine.ratePaise).toBe(9_900_000);

    // Corrected and sent again.
    const again = await call('BD', 'POST', `/clients/${clientId}/rate-card`, proposal({ origin: 'Salem', destination: 'Erode', ratePaise: 990_000 }));
    await call('BD', 'POST', `/clients/${clientId}/rate-card/rejected/${raised.approval.id}/dismiss`);
    expect((await call('BD', 'GET', `/clients/${clientId}/rate-card/rejected`)).some((r: any) => r.approvalId === raised.approval.id)).toBe(false);
    await call('LEADERSHIP', 'POST', `/approvals/${again.approval.id}/approve`);
    const card = await call('OPS', 'GET', `/clients/${clientId}/rate-card`);
    expect(card.find((l: any) => l.origin === 'Salem' && l.destination === 'Erode').ratePaise).toBe(990_000);
  });

  it('a deleted rate does not block the corrected one for the same route', async () => {
    const raised = await call('BD', 'POST', `/clients/${clientId}/rate-card`, proposal({ origin: 'Trichy', destination: 'Karur', ratePaise: 7_000_000 }));
    await call('LEADERSHIP', 'POST', `/approvals/${raised.approval.id}/approve`);
    const wrong = (await call('OPS', 'GET', `/clients/${clientId}/rate-card`)).find((l: any) => l.origin === 'Trichy');
    await call('LEADERSHIP', 'DELETE', `/clients/${clientId}/rate-card/${wrong.id}`, { reason: 'Entered with the wrong rate by mistake' });

    // The same route, entered again correctly: it is accepted and it approves.
    const again = await call('BD', 'POST', `/clients/${clientId}/rate-card`, proposal({ origin: 'Trichy', destination: 'Karur', ratePaise: 700_000 }));
    const approved = await call('LEADERSHIP', 'POST', `/approvals/${again.approval.id}/approve`);
    expect(approved.status).toBe('APPROVED');
  });

  it('edits a rate change that is still waiting', async () => {
    const lane = db.rateCards[clientId].find((l: any) => !l.deletedAt && !db.rateRevisions.some((r: any) => r.fromLaneId === l.id && r.status === 'PENDING'))!;
    const raised = await call('BD', 'POST', `/clients/${clientId}/rate-revisions`, {
      laneId: lane.id,
      newRatePaise: lane.ratePaise + 500_000,
      effectiveFrom: '2026-12-01',
      reason: 'Diesel went up; the client agreed the new rate by mail.',
      approvalMailSubject: 'Rate change approval',
    });
    const revisionId = raised.approval.action.revisionId;
    const edited = await call('BD', 'PATCH', `/clients/${clientId}/rate-revisions/${revisionId}`, { newRatePaise: lane.ratePaise + 50_000 });
    expect(edited.newRatePaise).toBe(lane.ratePaise + 50_000);
    const inbox = await call('LEADERSHIP', 'GET', '/approvals?status=PENDING');
    expect(inbox.find((a: any) => a.id === raised.approval.id).amountPaise).toBe(lane.ratePaise + 50_000);
  });
});

import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { db } from './db';
import type { RoleCode } from '../lib/permissions';

/**
 * Cancelling an indent, reviewing a stale one, and taking a load off its
 * transporter — driven through the fixture's own adapter, the way a browser test
 * cannot (a week's ageing and a hand-off between desks).
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const failure = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  try {
    await call(role, method, url, data);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

// i-4462: Apex Ceramics, OPEN, no quotes, band ₹42,000 – ₹47,000. v-2301 is an ACTIVE transporter.
const OPEN_INDENT = 'i-4462';
const ACTIVE_VENDOR = 'v-2301';

const award = async (indentId: string, amountPaise = 4_400_000) => {
  const indent = await call('OPS', 'POST', `/indents/${indentId}/quotes`, { vendorId: ACTIVE_VENDOR, amountPaise });
  const quote = indent.quotes.find((q: any) => q.vendorId === ACTIVE_VENDOR && q.status === 'SUBMITTED');
  return call('OPS', 'POST', `/indents/${indentId}/award`, { quoteId: quote.id });
};

describe('reassigning the transporter', () => {
  it('takes an awarded load off its transporter, keeping the trip number, and gives it to the next quote', async () => {
    const id = OPEN_INDENT;
    const awarded = await award(id, 4_400_000);
    expect(awarded.stage).toBe('TRIP_CREATED');
    const tripCode = awarded.tripCode;
    expect(tripCode).toBeTruthy();

    // Only Leadership holds the reassign permission; the API guard is theirs.
    const reopened = await call('LEADERSHIP', 'POST', `/indents/${id}/reassign-transporter`, {
      reason: 'The transporter could not provide the truck',
    });
    expect(reopened.stage).toBe('OPEN');
    expect(reopened.vendorId).toBeNull();
    expect(reopened.awardedQuoteId).toBeNull();
    expect(reopened.quotes.some((q: any) => q.status === 'WITHDRAWN')).toBe(true);
    // The trip is set aside, not deleted.
    expect(db.trips.find((t: any) => t.code === tripCode)!.stage).toBe('CANCELLED');

    // The next quote to be accepted revives that same trip for its transporter.
    db.vendors.find((v: any) => v.id === 'v-2214')!.status = 'ACTIVE';
    const second = await call('OPS', 'POST', `/indents/${id}/quotes`, { vendorId: 'v-2214', amountPaise: 4_500_000 });
    const quote = second.quotes.find((q: any) => q.vendorId === 'v-2214' && q.status === 'SUBMITTED');
    const placed = await call('OPS', 'POST', `/indents/${id}/award`, { quoteId: quote.id });
    expect(placed.tripCode).toBe(tripCode);
    expect(placed.vendorId).toBe('v-2214');
    expect(db.trips.filter((t: any) => t.indentCode === placed.code)).toHaveLength(1);
    expect(db.trips.find((t: any) => t.code === tripCode)!.stage).toBe('OPEN');
  });

  it('refuses once an advance has been paid or the truck has left', async () => {
    const started = db.trips.find((t: any) => t.stage === 'IN_TRANSIT');
    if (started) {
      const indent = db.indents.find((i: any) => i.code === started.indentCode);
      if (indent) {
        expect(await failure('LEADERSHIP', 'POST', `/indents/${indent.id}/reassign-transporter`, { reason: 'Too late for that' })).toMatch(/left|advance|awarded/i);
      }
    }
  });
});

describe('cancelling an indent', () => {
  it('needs a remark, and closes the load with it', async () => {
    expect(await failure('OPS', 'POST', `/indents/${OPEN_INDENT}/cancel`, { reason: '' })).toMatch(/why the load/i);
    const cancelled = await call('OPS', 'POST', `/indents/${OPEN_INDENT}/cancel`, { reason: 'The client withdrew the load' });
    expect(cancelled.stage).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('The client withdrew the load');
    expect(await failure('OPS', 'POST', `/indents/${OPEN_INDENT}/cancel`, { reason: 'Again, for luck' })).toMatch(/already cancelled/i);
  });

  it('an order for a cancelled load ends as cancelled, not as a load still waiting for a transporter', async () => {
    const order = await call('OPS', 'GET', `/orders/${OPEN_INDENT}`);
    expect(order.status).toBe('CANCELLED');
  });
});

describe('a stale indent', () => {
  it('appears after a week untouched and leaves when it is kept', async () => {
    // i-4468 is OPEN with a placement failure recorded; age it by hand.
    const indent = db.indents.find((i: any) => i.id === 'i-4468')!;
    indent.updatedAt = new Date(Date.now() - 9 * 86_400_000).toISOString();
    let stale = await call('OPS', 'GET', '/indents/stale');
    expect(stale.map((s: any) => s.id)).toContain('i-4468');
    expect(stale.find((s: any) => s.id === 'i-4468').idleDays).toBeGreaterThanOrEqual(9);

    await call('OPS', 'POST', '/indents/i-4468/keep');
    stale = await call('OPS', 'GET', '/indents/stale');
    expect(stale.map((s: any) => s.id)).not.toContain('i-4468');
  });
});


import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { db } from './db';
import type { RoleCode } from '../lib/permissions';
// The real rules, straight out of internal-api — dependency-free on purpose so
// a portal test can reach them (same approach as `rate-revision-drift.test.ts`).
import {
  checkQuoteCorrection,
  checkQuoteRemoval,
  planLoadCorrection,
} from '../../../internal-api/src/modules/indents/corrections';

/**
 * The console's fixture and the API must refuse the same corrections with the
 * same codes, or a screen that works against the fixture breaks against the
 * real server. Each case is put to both and the answers compared.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const fixtureRefusal = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  try {
    await call(role, method, url, data);
  } catch (e) {
    return String((e as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code ?? 'ERROR');
  }
  return null;
};

const apiRefusal = (r: { ok: boolean; refusal?: { code: string } }) => (r.ok ? null : r.refusal!.code);

// i-4462: Apex Ceramics, OPEN, no quotes yet.
const INDENT = 'i-4462';

describe('a load request correction is refused alike', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['nothing changed', { material: '__SAME__' }],
    ['a weight of nothing', { weightTn: 0 }],
    ['a weight past any truck', { weightTn: 250 }],
    ['freight in part-paise', { sellRatePaise: 12.5 }],
    ['a one-letter material', { material: 'x' }],
    ['a pickup date that is not one', { pickupDate: 'tomorrow' }],
  ];

  for (const [name, change] of cases) {
    it(name, async () => {
      const indent = await call('OPS', 'GET', `/indents/${INDENT}`);
      const input = { ...change };
      if (input.material === '__SAME__') input.material = indent.material;
      const fixture = await fixtureRefusal('OPS', 'PATCH', `/indents/${INDENT}/details`, { ...input, reason: 'Checking the rules agree' });
      const api = apiRefusal(
        planLoadCorrection(
          {
            stage: indent.stage,
            material: indent.material,
            weightKg: Math.round(indent.weightTn * 1000),
            truckType: indent.truckType,
            pickupDate: String(indent.pickupDate),
            sellRatePaise: indent.sellRatePaise,
            pickupAddress: indent.pickupAddress ?? null,
            dropAddress: indent.dropAddress ?? null,
          },
          input as never,
          false,
        ),
      );
      expect(fixture).toBe(api);
      expect(api).not.toBeNull();
    });
  }
});

describe('a quote correction is refused alike', () => {
  it('the same amount, and an amount of nothing', async () => {
    const withQuote = await call('OPS', 'POST', `/indents/${INDENT}/quotes`, { vendorId: 'v-2301', amountPaise: 4_400_000 });
    const quote = withQuote.quotes.find((q: any) => q.vendorId === 'v-2301');
    for (const amount of [4_400_000, 0]) {
      const fixture = await fixtureRefusal('OPS', 'PATCH', `/indents/${INDENT}/quotes/${quote.id}`, { amountPaise: amount, reason: 'Checking the rules agree' });
      const api = apiRefusal(checkQuoteCorrection({ status: quote.status, amountPaise: quote.amountPaise }, amount, null));
      expect(fixture).toBe(api);
    }
  });

  it('an awarded quote cannot be removed', async () => {
    const indent = await call('OPS', 'GET', `/indents/${INDENT}`);
    const quote = indent.quotes.find((q: any) => q.vendorId === 'v-2301');
    await call('OPS', 'POST', `/indents/${INDENT}/award`, { quoteId: quote.id });
    const after = await call('OPS', 'GET', `/indents/${INDENT}`);
    const awarded = after.quotes.find((q: any) => q.id === quote.id);
    const fixture = await fixtureRefusal('OPS', 'DELETE', `/indents/${INDENT}/quotes/${quote.id}`, { reason: 'Checking the rules agree' });
    const api = apiRefusal(checkQuoteRemoval(awarded.status, after.stage));
    expect(fixture).toBe(api);
    expect(api).toBe('QUOTE_CLOSED');
  });

  it('below an advance already paid', async () => {
    const trip: any = db.trips.find((t: any) => t.indentId === INDENT);
    const indent = await call('OPS', 'GET', `/indents/${INDENT}`);
    const quote = indent.quotes.find((q: any) => q.id === indent.awardedQuoteId);
    if (!trip || !quote) return;
    trip.advancePaidPaise = 1_000_000;
    const fixture = await fixtureRefusal('OPS', 'PATCH', `/indents/${INDENT}/quotes/${quote.id}`, { amountPaise: 900_000, reason: 'Checking the rules agree' });
    const api = apiRefusal(
      checkQuoteCorrection({ status: quote.status, amountPaise: quote.amountPaise }, 900_000, {
        advancePaidPaise: trip.advancePaidPaise,
        balancePaidPaise: trip.balancePaidPaise ?? 0,
      }),
    );
    expect(fixture).toBe(api);
    expect(api).toBe('BELOW_ADVANCE');
  });
});

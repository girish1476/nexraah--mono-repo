import { beforeEach, describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import type { RoleCode } from '../lib/permissions';
// The real rules, imported straight out of internal-api — dependency-free on
// purpose so a portal test can reach them (same approach as
// `rate-revision-drift.test.ts`).
import { checkNewLane, type NewLaneInput } from '../../../internal-api/src/modules/clients/rate-lane';

/**
 * Adding a lane to a rate card, driven through the fixture's own adapter.
 *
 * Two things are asserted that a browser test cannot: the second signature
 * really is what puts the lane on the card (the fixture db lives inside one
 * page, so a Finance page and a Compliance page can never see each other), and
 * the fixture refuses the same cases `rate-lane.ts` does.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const refusal = async (role: RoleCode, url: string, data: unknown) => {
  try {
    await call(role, 'POST', url, data);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

const lane = (over: Record<string, unknown> = {}) => ({
  origin: 'Visakhapatnam',
  destination: 'Hyderabad',
  truckType: '32 ft MXL',
  ratePaise: 4500000,
  transitDays: 3,
  validFrom: '2026-10-01',
  reason: 'Annexure 2 of the signed agreement dated 1 September',
  transitPenaltyApplies: false,
  approvalMailSubject: 'RE: rate approval from BD and Leadership',
  ...over,
});

// c-0101 Mahalaxmi Textiles: CONTRACT, no rate card. c-0088 Sanghvi Metals: SPOT.
const CLIENT = 'c-0101';

beforeEach(() => localStorage.clear());

describe('adding a lane', () => {
  it('changes nothing until the second signature, then lands on the rate card', async () => {
    const before = await call('FINANCE', 'GET', `/clients/${CLIENT}/rate-card`);
    const sent = await call('FINANCE', 'POST', `/clients/${CLIENT}/rate-card`, lane({ destination: 'Chennai' }));
    expect(sent.approvalRequired).toBe(true);
    expect(sent.approval.kind).toBe('RATE_CARD_LANE');
    expect(sent.approval.requiredPermission).toBe('approve.contract');

    expect(await call('FINANCE', 'GET', `/clients/${CLIENT}/rate-card`)).toHaveLength(before.length);

    await call('COMPLIANCE', 'POST', `/approvals/${sent.approval.id}/approve`);
    const after = await call('FINANCE', 'GET', `/clients/${CLIENT}/rate-card`);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({
      origin: 'Visakhapatnam',
      destination: 'Chennai',
      truckType: '32 ft MXL',
      ratePaise: 4500000,
      transitDays: 3,
    });
  });

  it('refuses a second lane for the same route and truck over the same dates', async () => {
    const first = await call('FINANCE', 'POST', `/clients/${CLIENT}/rate-card`, lane({ destination: 'Vijayawada' }));
    await call('COMPLIANCE', 'POST', `/approvals/${first.approval.id}/approve`);
    const again = await refusal('FINANCE', `/clients/${CLIENT}/rate-card`, lane({ destination: ' vijayawada ' }));
    expect(again).toMatch(/already has an agreed rate/);
  });

  it('refuses a spot client, a short source and identical cities', async () => {
    expect(await refusal('FINANCE', '/clients/c-0088/rate-card', lane())).toMatch(/priced load by load/);
    expect(await refusal('FINANCE', `/clients/${CLIENT}/rate-card`, lane({ reason: 'per call' }))).toMatch(
      /where this rate was agreed/i,
    );
    expect(await refusal('FINANCE', `/clients/${CLIENT}/rate-card`, lane({ destination: 'visakhapatnam' }))).toMatch(
      /same/,
    );
  });
});

describe('fixture versus rate-lane.ts on duplicate detection', () => {
  const existing = [
    { validFrom: '2026-01-01', validTo: '2026-06-30' },
    { validFrom: '2026-07-01', validTo: null },
  ];
  const starts = ['2025-12-01', '2026-03-01', '2026-06-30', '2026-07-01', '2027-01-01'];
  const ends = [null, '2026-05-01', '2026-12-31'];

  for (const validFrom of starts) {
    for (const validTo of ends) {
      if (validTo && validTo < validFrom) continue;
      it(`${validFrom} → ${validTo ?? 'open'}`, async () => {
        // A fresh route per case, seeded with the same two periods the API rule is given.
        const route = `Case${validFrom}${validTo ?? 'open'}`;
        for (const [i, period] of existing.entries()) {
          const seeded = await call('FINANCE', 'POST', `/clients/${CLIENT}/rate-card`, lane({
            destination: route,
            validFrom: period.validFrom,
            validTo: period.validTo ?? undefined,
            ratePaise: 1000 + i,
          }));
          await call('COMPLIANCE', 'POST', `/approvals/${seeded.approval.id}/approve`);
        }
        const input: NewLaneInput = {
          origin: 'Visakhapatnam',
          destination: route,
          truckType: '32 ft MXL',
          ratePaise: 5000000,
          transitDays: 3,
          validFrom,
          validTo,
          reason: 'Annexure 2 of the signed agreement dated 1 September',
        };
        const api = checkNewLane(input, existing.map((p, i) => ({ id: String(i), ...p })));
        const fixture = await refusal('FINANCE', `/clients/${CLIENT}/rate-card`, {
          ...input,
          validTo: validTo ?? undefined,
          transitPenaltyApplies: false,
          approvalMailSubject: 'RE: rate approval from BD and Leadership',
        });
        expect(fixture === null, `${validFrom} → ${validTo}: API says ${api.refusal}, fixture says ${fixture}`).toBe(api.ok);
      });
    }
  }
});

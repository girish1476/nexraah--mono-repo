import { describe, it, expect } from 'vitest';
import { attentionItems, attentionSummary } from './attention';
import type { Profile, VendorDocument } from '@/app/profile/types';

/**
 * What the transporter has to act on.
 *
 * Before this, the Profile screen was reachable from two of the four tabs and
 * nothing anywhere else in the app said a paper had been rejected — a
 * transporter found out when their advance did not arrive. The header badge
 * and the top of the Profile screen both read from here, so they can never
 * disagree about the count.
 */

const doc = (over: Partial<VendorDocument> = {}): VendorDocument => ({
  kind: 'X',
  label: 'A paper',
  status: 'VERIFIED',
  rejectionReason: null,
  rejectedOn: null,
  expiredOn: null,
  groundsVehicleRegistrationNo: null,
  capture: false,
  needsGeotag: false,
  ...over,
});

const profile = (documents: VendorDocument[]): Profile =>
  ({
    vendorCode: 'V-1',
    companyName: 'Test Roadlines',
    contactName: 'A',
    phone: '9',
    city: 'Nashik',
    gstin: null,
    panMasked: 'X',
    aadhaarLast4: '0000',
    bankAccountMasked: 'X',
    bankIfsc: 'X',
    advancePolicyPct: 40,
    business: { trips: 0, valuePaise: 0, outstandingPaise: 0 },
    documents: [{ group: 'Papers', documents }],
  }) as Profile;

describe('what counts as needing attention', () => {
  it('picks up rejected, expired and missing papers', () => {
    const items = attentionItems(
      profile([
        doc({ kind: 'A', status: 'REJECTED' }),
        doc({ kind: 'B', status: 'EXPIRED' }),
        doc({ kind: 'C', status: 'MISSING' }),
      ]),
    );
    expect(items.map((i) => i.kind).sort()).toEqual(['A', 'B', 'C']);
  });

  it('leaves a paper that is already with compliance alone', () => {
    /*
     * The judgement call. Nagging somebody about a paper they have already
     * sent is how a badge stops being read — and there is nothing they can do
     * about it anyway.
     */
    expect(attentionItems(profile([doc({ status: 'PENDING' })]))).toEqual([]);
  });

  it('leaves verified papers alone', () => {
    expect(attentionItems(profile([doc({ status: 'VERIFIED' })]))).toEqual([]);
  });
});

describe('the order things are listed in', () => {
  const items = attentionItems(
    profile([
      doc({ kind: 'MISS', status: 'MISSING' }),
      doc({ kind: 'REJ', status: 'REJECTED', rejectionReason: 'Too old.' }),
      doc({
        kind: 'GROUND',
        status: 'EXPIRED',
        expiredOn: '2026-08-02',
        groundsVehicleRegistrationNo: 'MH 12 RB 7721',
      }),
      doc({ kind: 'EXP', status: 'EXPIRED', expiredOn: '2026-08-02' }),
    ]),
  );

  it('puts a paper that grounds a truck first', () => {
    // A truck standing idle is money not earned today. It outranks paperwork
    // that is merely wrong.
    expect(items[0].kind).toBe('GROUND');
  });

  it('then a rejection, then a plain expiry, then one never sent', () => {
    expect(items.map((i) => i.kind)).toEqual(['GROUND', 'REJ', 'EXP', 'MISS']);
  });
});

describe('what each line says', () => {
  it('names the truck a lapsed paper is grounding', () => {
    const [item] = attentionItems(
      profile([
        doc({
          status: 'EXPIRED',
          expiredOn: '2026-08-02',
          groundsVehicleRegistrationNo: 'MH 12 RB 7721',
        }),
      ]),
    );
    expect(item.why).toContain('MH 12 RB 7721');
    expect(item.why).toContain('cannot take new loads');
  });

  it('gives the compliance reason for a rejection', () => {
    const [item] = attentionItems(
      profile([doc({ status: 'REJECTED', rejectionReason: 'Electricity bill is over three months old.' })]),
    );
    expect(item.why).toContain('Electricity bill is over three months old.');
  });

  it('says what to do when the rejection reason never arrived', () => {
    /*
     * A rejection with no reason gets re-uploaded identically and rejected
     * again. If we cannot say why, the honest answer is "call your branch",
     * not silence.
     */
    const [item] = attentionItems(profile([doc({ status: 'REJECTED', rejectionReason: null })]));
    expect(item.why).toContain('call your branch');
  });
});

describe('the one-line summary', () => {
  it('leads with the truck, not the paper count', () => {
    const summary = attentionSummary(
      profile([
        doc({ kind: 'A', status: 'MISSING' }),
        doc({ kind: 'B', status: 'REJECTED', rejectionReason: 'x' }),
        doc({
          kind: 'C',
          status: 'EXPIRED',
          groundsVehicleRegistrationNo: 'MH 12 RB 7721',
        }),
      ]),
    );
    // "1 truck is off the road" is acted on today; "3 papers" is scrolled past.
    expect(summary.headline).toContain('MH 12 RB 7721');
    expect(summary.groundsATruck).toBe(true);
    expect(summary.count).toBe(3);
  });

  it('counts the trucks when more than one is grounded', () => {
    const summary = attentionSummary(
      profile([
        doc({ kind: 'A', status: 'EXPIRED', groundsVehicleRegistrationNo: 'MH 12 RB 7721' }),
        doc({ kind: 'B', status: 'EXPIRED', groundsVehicleRegistrationNo: 'MH 04 TT 2019' }),
      ]),
    );
    expect(summary.headline).toContain('2 of your trucks');
  });

  it('does not count one truck twice when two of its papers have lapsed', () => {
    const summary = attentionSummary(
      profile([
        doc({ kind: 'A', status: 'EXPIRED', groundsVehicleRegistrationNo: 'MH 12 RB 7721' }),
        doc({ kind: 'B', status: 'EXPIRED', groundsVehicleRegistrationNo: 'MH 12 RB 7721' }),
      ]),
    );
    expect(summary.headline).toContain('MH 12 RB 7721');
    expect(summary.headline).not.toContain('2 of your trucks');
  });

  it('gets the singular right', () => {
    const one = attentionSummary(profile([doc({ status: 'MISSING' })]));
    expect(one.headline).toBe('1 paper needs something from you');
  });

  it('says so plainly when nothing is outstanding', () => {
    const clear = attentionSummary(profile([doc({ status: 'VERIFIED' })]));
    expect(clear.count).toBe(0);
    expect(clear.headline).toBe('Every paper is in order');
  });

  it('is silent rather than wrong before the profile has loaded', () => {
    // The header renders on every screen and mounts before the fetch returns.
    // A badge that flashes "0 problems" and then "4" is worse than no badge.
    const none = attentionSummary(null);
    expect(none.count).toBe(0);
    expect(none.headline).toBe('');
  });
});

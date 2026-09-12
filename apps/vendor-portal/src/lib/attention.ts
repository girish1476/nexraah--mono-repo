import type { DocumentStatus, Profile, VendorDocument } from '@/app/profile/types';

/**
 * What the transporter has to do something about, worst first.
 *
 * Pure and dependency-free so it can be tested without a browser, and so the
 * header badge and the Profile screen count the same things. Two places
 * counting "what needs attention" separately is how a badge ends up saying 3
 * while the screen shows 2.
 *
 * Only three of the five statuses are the transporter's problem. `PENDING` is
 * sitting with compliance — nagging somebody about a paper they have already
 * sent is how a badge gets ignored — and `VERIFIED` is done.
 */
const ACTIONABLE: DocumentStatus[] = ['EXPIRED', 'REJECTED', 'MISSING'];

export type Urgency = 'GROUNDS_A_TRUCK' | 'REJECTED' | 'EXPIRED' | 'MISSING';

export interface AttentionItem {
  kind: string;
  label: string;
  status: DocumentStatus;
  urgency: Urgency;
  /** The whole sentence, already written for the transporter. */
  why: string;
  /** The group heading it lives under, so the screen can point at the row. */
  group: string;
  capture: boolean;
  needsGeotag: boolean;
  rejectionReason: string | null;
  rejectedOn: string | null;
  expiredOn: string | null;
  groundsVehicleRegistrationNo: string | null;
}

/**
 * Ranked by what it costs the transporter, not by document type.
 *
 * A lapsed paper that grounds a named truck is first because a truck sitting
 * idle is money not being earned today. A rejection is second: somebody has
 * looked at it and said no, so it will not resolve on its own. A paper never
 * sent is last — nothing has gone wrong yet.
 */
const RANK: Record<Urgency, number> = {
  GROUNDS_A_TRUCK: 0,
  REJECTED: 1,
  EXPIRED: 2,
  MISSING: 3,
};

function urgencyOf(doc: VendorDocument): Urgency {
  if (doc.groundsVehicleRegistrationNo) return 'GROUNDS_A_TRUCK';
  if (doc.status === 'REJECTED') return 'REJECTED';
  if (doc.status === 'EXPIRED') return 'EXPIRED';
  return 'MISSING';
}

/** One sentence saying what is wrong and what it costs — never a bare status word. */
function whyOf(doc: VendorDocument): string {
  if (doc.groundsVehicleRegistrationNo) {
    return `${doc.groundsVehicleRegistrationNo} cannot take new loads until you upload the renewed one.`;
  }
  if (doc.status === 'REJECTED') {
    return doc.rejectionReason
      ? `Not accepted — ${doc.rejectionReason}`
      : 'Not accepted. Nexraah has not sent the reason through yet — call your branch before sending it again.';
  }
  if (doc.status === 'EXPIRED') {
    return doc.expiredOn
      ? `The date on this paper passed on ${doc.expiredOn}. Upload the renewed one.`
      : 'The date on this paper has passed. Upload the renewed one.';
  }
  return 'Nexraah does not have this paper yet.';
}

export function attentionItems(profile: Profile): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const group of profile.documents) {
    for (const doc of group.documents) {
      if (!ACTIONABLE.includes(doc.status)) continue;
      items.push({
        kind: doc.kind,
        label: doc.label,
        status: doc.status,
        urgency: urgencyOf(doc),
        why: whyOf(doc),
        group: group.group,
        capture: doc.capture,
        needsGeotag: doc.needsGeotag,
        rejectionReason: doc.rejectionReason,
        rejectedOn: doc.rejectedOn,
        expiredOn: doc.expiredOn,
        groundsVehicleRegistrationNo: doc.groundsVehicleRegistrationNo,
      });
    }
  }

  // Stable within a rank: the order they appear in the profile, which is the
  // order the groups are shown further down the screen.
  return items.sort((a, b) => RANK[a.urgency] - RANK[b.urgency]);
}

export interface AttentionSummary {
  count: number;
  /** True when at least one lapsed paper is stopping a named truck. */
  groundsATruck: boolean;
  /** One line for the header badge and the top of the Profile screen. */
  headline: string;
}

export function attentionSummary(profile: Profile | null): AttentionSummary {
  if (!profile) return { count: 0, groundsATruck: false, headline: '' };

  const items = attentionItems(profile);
  const grounded = items.filter((i) => i.urgency === 'GROUNDS_A_TRUCK');

  if (items.length === 0) {
    return { count: 0, groundsATruck: false, headline: 'Every paper is in order' };
  }

  /*
   * The headline leads with the truck, not the paper count. "1 truck is off
   * the road" is a number a transporter acts on today; "4 papers need
   * attention" is a number they scroll past.
   */
  if (grounded.length > 0) {
    const trucks = [...new Set(grounded.map((g) => g.groundsVehicleRegistrationNo))].filter(
      Boolean,
    ) as string[];
    const truckList = trucks.length === 1 ? trucks[0] : `${trucks.length} of your trucks`;
    return {
      count: items.length,
      groundsATruck: true,
      headline: `${truckList} cannot take loads until a paper is renewed`,
    };
  }

  return {
    count: items.length,
    groundsATruck: false,
    headline:
      items.length === 1
        ? '1 paper needs something from you'
        : `${items.length} papers need something from you`,
  };
}

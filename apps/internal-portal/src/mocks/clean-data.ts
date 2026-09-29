/**
 * The clean start: no invented business, just what is needed to begin.
 *
 * The console shipped with a fictional book of business — dozens of loads,
 * trips, bills and payments — which made every screen look busy and made a
 * real walk through the flow impossible to tell from the seed. This strips all
 * of that away and leaves:
 *
 *  - the company itself: its settings, number series, branches and the people
 *    who sign in;
 *  - ONE cleared client with ONE agreed rate lane (approved on a BD/Leadership
 *    mail, carrying its transit days and late-delivery penalty);
 *  - ONE active transporter with its papers verified and one truck.
 *
 * Everything else — indents, quotes, trips, documents, payments, SDRs, invoices —
 * is empty, so the first thing anybody does is raise the first indent, and every
 * record on every screen after that is one they made.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function applyCleanSlate(db: Record<string, any>): void {
  // ---- the one client and its one rate lane ---------------------------------
  const client = (db.clients as any[]).find((c) => c.id === 'c-0092');
  db.clients = client ? [{ ...client, status: 'ACTIVE', outstandingPaise: 0, documents: client.documents ?? [] }] : [];
  const lane = (db.rateCards['c-0092'] ?? []).find((l: any) => l.id === 'rc-1');
  db.rateCards = lane
    ? {
        'c-0092': [
          {
            ...lane,
            // Agreed by BD and Leadership on a mail, signed off by Compliance.
            transitPenaltyApplies: true,
            transitPenaltyPerDayPaise: 50_000,
            approvalMailSubject: 'RE: Berger Paints Kolkata to Nashik rate — approved by BD and Leadership',
          },
        ],
      }
    : {};

  // ---- the one transporter, fully cleared --------------------------------------
  const vendor = (db.vendors as any[]).find((v) => v.id === 'v-2214');
  db.vendors = vendor
    ? [
        {
          ...vendor,
          status: 'ACTIVE',
          verifiedBy: 'Meera Iyer',
          fleetCount: 1,
          documents: (vendor.documents as any[]).map((d) => ({
            ...d,
            status: 'VERIFIED',
            reference: d.reference ?? 'On file',
            attachmentId: d.attachmentId ?? `att-v-${String(d.kind).toLowerCase()}`,
            validTo: d.validTo ?? null,
          })),
          business: {
            trips: 0,
            revenuePaise: 0,
            marginPaise: 0,
            advanceOutstandingPaise: 0,
            balancePendingPaise: 0,
            penaltiesAccruedPaise: 0,
            topLanes: [],
          },
          fleet: [
            { registration: 'MH 15 GT 4482', type: '32 ft SXL', capacityTn: 21, bodyType: 'Closed', currentCity: 'Kolkata', status: 'AVAILABLE' },
          ],
          advanceHistory: [{ oldPct: null, newPct: 40, changedBy: 'Meera Iyer', changedAt: daysAgo(30).slice(0, 10), approvalId: null }],
        },
      ]
    : [];

  // ---- everything operational starts empty --------------------------------------
  for (const key of [
    'approvals',
    'leads',
    'marketGap',
    'issues',
    'indents',
    'trips',
    'podReceipts',
    'payments',
    'sdr',
    'sdrRecoveries',
    'penaltyWaivers',
    'vendorBills',
    'invoices',
    'receipts',
    'rfqs',
    'telematics',
    'rateRevisions',
    'tickets',
    'auditEvents',
    'importBatches',
  ]) {
    if (key in db) db[key] = [];
  }

  // ---- numbering starts at the beginning ----------------------------------------
  const start: Record<string, [number, number]> = {
    TRIP: [100001, 6],
    INDENT: [1001, 4],
    LR: [1, 5],
    INVOICE: [1, 6],
    VENDOR: [2, 4],
    CLIENT: [2, 4],
    QUOTE: [1, 5],
    SDR: [1, 4],
    RECEIPT: [1, 4],
    LEAD: [1, 4],
    ISSUE: [1, 4],
    POD_RECEIPT: [1, 4],
  };
  for (const s of db.numberSeries as any[]) {
    if (start[s.key]) {
      s.nextValue = start[s.key][0];
      s.width = start[s.key][1];
    }
  }
}

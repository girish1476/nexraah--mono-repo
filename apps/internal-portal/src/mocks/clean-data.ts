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

/**
 * The company as it is printed on every document. The address is kept as the
 * lines it is written in; where it has to sit on one line (the footer band) the
 * lines are joined with commas.
 */
export const REAL_COMPANY = {
  name: 'NEXUS FREIGHT PRIVATE LIMITED',
  gstin: '37AAKCN9322K1ZY',
  pan: 'AAKCN9322K',
  cin: '',
  address: '9-1-128, Ganesh Nagar, Revenue Ward 64, Gajuwaka\nVisakhapatnam, Andhra Pradesh\n530026',
  bank: 'Account No: 256303933846 · IFSC Code: INDB0000081',
};

/** The made-up company of the regression data, and earlier spellings of the real one. */
const SEEDED_GSTIN = '27AABCN4471K1ZV';
const EARLIER_NAME = 'Nexus Freight Private Limited';
const EARLIER_ADDRESS = '9-1-128, Ganesh Nagar, Revenue Ward 64, Gajuwaka, Visakhapatnam, Andhra Pradesh - 530026';

/**
 * Puts the real company on data a browser saved before it was known.
 *
 * What a browser saved is put back over the clean start, so one that first
 * opened the console while it still carried the made-up company kept printing
 * that company — its name, a Nashik address, its GST number — on every invoice.
 * Only a company nobody has edited is touched: one still carrying the made-up
 * GST number is replaced, and the real one's earlier spellings are brought up
 * to date. Anything typed in Admin → Control panel is left as it was typed.
 */
export function correctSavedCompany(db: Record<string, any>): void {
  const company = db.config?.company;
  if (!company) return;
  if (company.gstin === SEEDED_GSTIN) {
    db.config.company = { ...company, ...REAL_COMPANY };
    return;
  }
  if (company.gstin !== REAL_COMPANY.gstin) return;
  if (company.name === EARLIER_NAME) company.name = REAL_COMPANY.name;
  if (company.address === EARLIER_ADDRESS) company.address = REAL_COMPANY.address;
}

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

  // ---- the company, as it is printed on the invoice -----------------------------
  // The seeded company is a made-up one for the regression data. A clean start
  // carries the real letterhead, so the first invoice raised prints correctly;
  // Admin → Control panel still edits every line of it.
  if (db.config?.company) {
    db.config.company = {
      ...db.config.company,
      ...REAL_COMPANY,
    };
  }

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

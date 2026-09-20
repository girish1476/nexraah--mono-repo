/**
 * In-memory fixture data for the mock adapter.
 *
 * Every shape here is the shape `internal-api` must return — the files in
 * `docs/api/` are generated from this understanding, so when the backend is
 * built, these objects are the acceptance samples. Money is paise (NFR-09).
 *
 * Names and figures follow the approved prototype so screenshots match.
 */

import { RoleCode } from '@/lib/permissions';

const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export type DocState = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface Doc {
  kind: string;
  label: string;
  group: 'CLIENT' | 'VEHICLE' | 'DRIVER' | 'LR' | 'POD';
  gatesAdvance: boolean;
  status: DocState;
  attachmentId: string | null;
  uploadedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectReason: string | null;
  keyedValues: Record<string, string>;
}

export interface FixtureAccount {
  userId: string;
  name: string;
  email: string;
  role: RoleCode;
  /** Branch code, or `null` for someone who sees every branch. */
  branch: string | null;
}

/**
 * Every fixture account — a **list**, because branch scoping is a property of
 * the person, not of their role.
 *
 * This was `Record<RoleCode, …>`, one account per role, which was fine while
 * `BRANCH_MGR` existed and was the only branch-scoped role. The merge folded
 * that role into Operations and moved scoping onto the user record
 * (`auth.service.ts` now passes `user.branch` straight through), and a
 * role-keyed map cannot express the case that matters after that change: two
 * people, same role, different branches. Not "no branched fixture" — no way
 * to *write* one. The branch-scoping tests were deleted rather than fixed for
 * exactly that reason.
 *
 * Sunita Rao is the scoped Operations account. She was the BRANCH_MGR the
 * merge reassigned, and `supabase/seed.sql` makes the same person the one
 * carrying a branch — deliberately the only one, since with passthrough a
 * stray branch silently narrows somebody.
 *
 * Her branch differs from the seed's on purpose: `HYD` there, `NSK` here,
 * because these fixtures' trips and indents are Nashik's. Scoping her to a
 * branch with no rows would prove only that an empty list is empty.
 */
export const ACCOUNTS: FixtureAccount[] = [
  { userId: 'u-ops', name: 'Anil Deshmukh', email: 'anil@nexraah.in', role: 'OPS', branch: null },
  { userId: 'u-ops-nsk', name: 'Sunita Rao', email: 'sunita@nexraah.in', role: 'OPS', branch: 'NSK' },
  { userId: 'u-cmp', name: 'Meera Iyer', email: 'meera@nexraah.in', role: 'COMPLIANCE', branch: null },
  { userId: 'u-fin', name: 'Rakesh Nair', email: 'rakesh@nexraah.in', role: 'FINANCE', branch: null },
  // Business development. Added because `ROLE_CODES` gained `BD` and this map
  // had no entry for it — `USERS.BD` was `undefined`, which the `Record` cast
  // hid from the compiler and would have surfaced as a crash the first time
  // anything asked who verified a document as BD.
  { userId: 'u-bd', name: 'Neha Bhatt', email: 'neha@nexraah.in', role: 'BD', branch: null },
  { userId: 'u-lead', name: 'Vikram Shah', email: 'vikram@nexraah.in', role: 'LEADERSHIP', branch: null },
  { userId: 'u-adm', name: 'S. Krishnan', email: 'krishnan@nexraah.in', role: 'ADMIN', branch: null },
];

/**
 * The default account for a role — the first listed, always the unscoped one.
 *
 * Kept as a map so the ~20 `USERS[role]` call sites in `mocks/index.ts` (who
 * verified a document, who raised an issue) carry on unchanged. Anything that
 * cares about *branch* must read the token's claim instead: this map can only
 * ever answer with the role's default person.
 */
export const USERS: Record<RoleCode, FixtureAccount> = ACCOUNTS.reduce(
  (byRole, account) => {
    // First listed wins, which is why the unscoped account is listed first.
    if (!byRole[account.role]) byRole[account.role] = account;
    return byRole;
  },
  {} as Record<RoleCode, FixtureAccount>,
);

/**
 * The password every fixture account signs in with, when — and only when —
 * `NEXT_PUBLIC_USE_MOCKS` is on.
 *
 * It is in plain text on purpose. Hashing it would be theatre: this file is
 * compiled into the browser bundle, so whatever it held would ship next to
 * the code that checks it, and a reader could be forgiven for thinking a
 * real credential store had been built. Nothing here is reachable with mocks
 * off — `lib/auth.ts` sends the password to Supabase Auth on that path and
 * never consults this list. These six accounts do not exist in any database.
 */
export const DEMO_PASSWORD = 'nexraah';

/**
 * Fixture email → the whole account, matched case-insensitively at sign-in.
 *
 * The account, not the role: signing in as Sunita Rao has to produce a token
 * carrying her branch, and a role alone cannot say which of two Operations
 * people just signed in.
 */
export const CREDENTIALS: Record<string, FixtureAccount> = Object.fromEntries(
  ACCOUNTS.map((account) => [account.email.toLowerCase(), account]),
);

export const SUPPLY_SOURCE_LABEL: Record<string, string> = {
  UNION: 'Transport union',
  MARKET: 'Open market',
  BOTH: 'Union and market',
  DIRECT_OWNER: 'Direct owners',
};

/**
 * `supplySource` is left null on two branches on purpose — "Not recorded" is a
 * real state an operator has to be able to see and fix, not an oversight.
 */
export const BRANCHES = [
  { id: 'br-nsk', code: 'NSK', name: 'Nashik', city: 'Nashik', catchmentKm: 150,
    supplySource: 'BOTH', supplySourceLabel: 'Union and market',
    supplyRemarks: 'Union rates hold only through the cane season.' },
  { id: 'br-pun', code: 'PUN', name: 'Pune', city: 'Pune', catchmentKm: 150,
    supplySource: 'MARKET', supplySourceLabel: 'Open market', supplyRemarks: null },
  { id: 'br-vja', code: 'VJA', name: 'Vijayawada', city: 'Vijayawada', catchmentKm: 150,
    supplySource: 'UNION', supplySourceLabel: 'Transport union',
    supplyRemarks: 'Single union controls the port lanes.' },
  { id: 'br-gdm', code: 'GDM', name: 'Gandhidham', city: 'Gandhidham', catchmentKm: 150,
    supplySource: 'DIRECT_OWNER', supplySourceLabel: 'Direct owners', supplyRemarks: null },
  { id: 'br-hsr', code: 'HSR', name: 'Hosur', city: 'Hosur', catchmentKm: 150,
    supplySource: null, supplySourceLabel: null, supplyRemarks: null },
  { id: 'br-vzg', code: 'VZG', name: 'Visakhapatnam (HO)', city: 'Visakhapatnam', catchmentKm: 150,
    supplySource: null, supplySourceLabel: null, supplyRemarks: null },
] as {
  id: string;
  code: string;
  name: string;
  city: string;
  catchmentKm: number;
  supplySource: string | null;
  supplySourceLabel: string | null;
  supplyRemarks: string | null;
}[];

export const ADVANCE_DOCUMENT_SET = [
  'CLIENT_INVOICE_OR_PO',
  'EWAY_BILL',
  'RC',
  'INSURANCE',
  'FITNESS',
  'PERMIT',
  'PUC',
  'DRIVING_LICENCE',
];

export const DOC_LABEL: Record<string, string> = {
  CLIENT_INVOICE_OR_PO: 'Client invoice or purchase order',
  EWAY_BILL: 'E-way bill',
  RC: 'Registration certificate',
  INSURANCE: 'Goods insurance',
  FITNESS: 'Fitness certificate',
  PERMIT: 'National permit',
  PUC: 'Pollution certificate',
  DRIVING_LICENCE: 'Driving licence',
  LR: 'Lorry receipt',
  POD: 'Proof of delivery',
  LOADING_SLIP: 'Loading slip',
  TRADE_LICENCE: 'Trade licence',
  LABOUR_LICENCE: 'Labour licence',
  UDYAM: 'Udyam / MSME certificate',
  TDS_DECLARATION: 'TDS declaration',
  BANK_STATEMENT: 'Bank statement or cancelled cheque',
  TRANSPORTER_AGREEMENT: 'Transporter agreement',
};

function tripDocs(): Doc[] {
  const base: [string, Doc['group'], DocState][] = [
    ['CLIENT_INVOICE_OR_PO', 'CLIENT', 'VERIFIED'],
    ['EWAY_BILL', 'CLIENT', 'MISSING'],
    ['RC', 'VEHICLE', 'PENDING'],
    ['INSURANCE', 'VEHICLE', 'VERIFIED'],
    ['FITNESS', 'VEHICLE', 'VERIFIED'],
    ['PERMIT', 'VEHICLE', 'VERIFIED'],
    ['PUC', 'VEHICLE', 'VERIFIED'],
    ['DRIVING_LICENCE', 'DRIVER', 'MISSING'],
    ['LR', 'LR', 'VERIFIED'],
    ['POD', 'POD', 'MISSING'],
  ];
  return base.map(([kind, group, status]) => ({
    kind,
    label: DOC_LABEL[kind] ?? kind,
    group,
    gatesAdvance: ADVANCE_DOCUMENT_SET.includes(kind),
    status,
    attachmentId: status === 'MISSING' ? null : `att-${kind.toLowerCase()}`,
    uploadedAt: status === 'MISSING' ? null : daysAgo(1),
    verifiedBy: status === 'VERIFIED' ? 'Meera Iyer' : null,
    verifiedAt: status === 'VERIFIED' ? daysAgo(1) : null,
    rejectReason: null,
    keyedValues: (kind === 'EWAY_BILL'
      ? { ewayNo: '', vehicleNo: '', validTill: '' }
      : kind === 'CLIENT_INVOICE_OR_PO'
        ? { invoiceNo: 'SM/26/1189', invoiceValue: '1840000', consignorGstin: '27AAECS9111M1Z4' }
        : {}) as Record<string, string>,
  }));
}

/* ---- the mutable fixture database -------------------------------------- */

export const db = {
  config: {
    modules: {
      rfq: true,
      telematics: true,
      invoicing: true,
      import: true,
    },
    kyc_strict_gate: true,
    kyc_route: 'MANUAL' as 'MANUAL' | 'API',
    advance_document_set: [...ADVANCE_DOCUMENT_SET],
    advance_default_pct: 40,
    credit_default_days: 45,
    sla_hours: 24,
    pod_tat_days: 20,
    pod_penalty_per_day_paise: 10000,
    pod_forfeit_days: 40,
    eway_warning_window_hours: 12,
    overspeed_kmph: 80,
    halt_minutes: 90,
    dark_vehicle_interval_minutes: 120,
    minimum_margin_pct: 8,
    branch_catchment_km: 150,
    company: {
      name: 'Nexraah Logistics Private Limited',
      gstin: '27AABCN4471K1ZV',
      pan: 'AABCN4471K',
      cin: 'U63030MH2019PTC332211',
      address: 'Plot 44, MIDC Ambad, Nashik 422010, Maharashtra',
      bank: 'HDFC Bank · Nashik · A/c 50200044714471 · IFSC HDFC0000188',
      // 996511 — "Services provided by a goods transport agency in relation
      // to transport of goods by road", same value the real config seed
      // carries as of 20260920000000_company_sac_code.sql.
      sac: '996511',
      // Same default the real config seed carries as of
      // 20260920010000_company_signatory.sql — editable from /admin.
      signatory: 'Authorised Signatory',
    },
  },

  numberSeries: [
    { key: 'TRIP', prefix: 'TRP-', nextValue: 120882, width: 6, scope: 'GLOBAL', branchId: null },
    { key: 'LR', prefix: 'LR-', nextValue: 88216, width: 5, scope: 'GLOBAL', branchId: null },
    { key: 'INVOICE', prefix: 'NEX-INV-', nextValue: 412, width: 6, scope: 'GLOBAL', branchId: null },
    { key: 'INDENT', prefix: 'IND-', nextValue: 4472, width: 5, scope: 'GLOBAL', branchId: null },
    { key: 'VENDOR', prefix: 'VND-', nextValue: 2302, width: 4, scope: 'GLOBAL', branchId: null },
    { key: 'CLIENT', prefix: 'CLT-', nextValue: 93, width: 4, scope: 'GLOBAL', branchId: null },
    { key: 'CUSTOMER', prefix: 'CUS-', nextValue: 18, width: 4, scope: 'GLOBAL', branchId: null },
    { key: 'POD_RECEIPT', prefix: 'PDR-', nextValue: 771, width: 4, scope: 'BRANCH', branchId: 'br-nsk' },
    { key: 'QUOTE', prefix: 'BID-', nextValue: 9912, width: 4, scope: 'GLOBAL', branchId: null },
    { key: 'RECEIPT', prefix: 'RCT-', nextValue: 331, width: 4, scope: 'GLOBAL', branchId: null },
    { key: 'LEAD', prefix: 'LD-', nextValue: 88, width: 4, scope: 'GLOBAL', branchId: null },
    { key: 'ISSUE', prefix: 'IS-', nextValue: 45, width: 4, scope: 'GLOBAL', branchId: null },
  ],

  /** roleCode → permission code → level */
  roleMatrix: {} as Record<string, Record<string, 'NONE' | 'VIEW' | 'EDIT'>>,

  approvals: [
    {
      id: 'apr-1',
      kind: 'ABOVE_BAND_PRICE',
      entityType: 'indent',
      entityId: 'IND-4468',
      title: 'Award at ₹35,800 · band ceiling ₹33,000',
      detail:
        'Chakan → Coimbatore. Only two quotes in band, both from vendors without a fitness certificate on file.',
      amountPaise: 3580000,
      requesterId: 'u-bm',
      requesterName: 'Sunita Rao · OPS',
      approverRole: 'LEADERSHIP',
      requiredPermission: 'approve.above_band',
      reason: 'Only above-band quotes on this lane for three consecutive loads.',
      status: 'PENDING',
      createdAt: daysAgo(0),
    },
    {
      id: 'apr-2',
      kind: 'PENALTY_WAIVER',
      entityType: 'trip',
      entityId: 'TRP-120874',
      title: 'Waive ₹1,100 penalty · 11 days beyond window',
      detail:
        'Consignee refused to stamp until a shortage claim was settled. The delay is the client’s, not the vendor’s.',
      amountPaise: 110000,
      requesterId: 'u-cmp',
      requesterName: 'Meera Iyer · COMPLIANCE',
      approverRole: 'LEADERSHIP',
      requiredPermission: 'approve.waiver',
      reason: 'Consignee withheld the stamp pending a shortage claim that has since been settled in full.',
      status: 'PENDING',
      createdAt: daysAgo(0),
    },
    {
      id: 'apr-3',
      kind: 'ADVANCE_POLICY_CHANGE',
      entityType: 'vendor',
      entityId: 'VND-2214',
      title: 'Rathod Roadlines · advance policy 40% → 70%',
      detail: 'Vendor has run 41 trips with no POD breach and asks for a higher standing advance.',
      amountPaise: null,
      requesterId: 'u-cmp',
      requesterName: 'Meera Iyer · COMPLIANCE',
      approverRole: 'LEADERSHIP',
      requiredPermission: 'approve.exception',
      reason: 'Forty-one clean trips, zero POD breaches, and the lane needs the retention.',
      status: 'PENDING',
      createdAt: daysAgo(1),
    },
    {
      id: 'apr-4',
      kind: 'DOC_OVERRIDE',
      entityType: 'trip',
      entityId: 'TRP-120869',
      title: 'Place without fitness certificate · expires in 2 days',
      detail: 'Truck is loaded and at the gate. Vendor has produced the renewal receipt but not the certificate.',
      amountPaise: null,
      requesterId: 'u-ops',
      requesterName: 'Anil Deshmukh · OPS',
      approverRole: 'COMPLIANCE',
      requiredPermission: 'approve.exception',
      reason: 'Renewal receipt on file, certificate lapses in two days, truck is at the plant gate.',
      status: 'PENDING',
      createdAt: daysAgo(0),
    },
  ] as Record<string, any>[],

  vendors: [
    {
      id: 'v-2214',
      code: 'VND-2214',
      legalName: 'Rathod Roadlines',
      partyType: 'VENDOR',
      baseCity: 'Nashik',
      branchId: 'br-nsk',
      branchName: 'Nashik',
      gstin: '27AAKCR2148L1ZP',
      pan: 'AAKCR2148L',
      phone: '9822014471',
      altPhone: '9822014472',
      truckTypes: ['32 ft SXL', '22 ft container'],
      operatingStates: ['MH', 'GJ', 'MP', 'WB'],
      advancePct: 40,
      bankAccount: '••4471',
      ifsc: 'HDFC0000188',
      accountHolder: 'Rathod Roadlines',
      status: 'PENDING_VERIFICATION',
      verifiedBy: null,
      panelDate: '2024-03-11',
      rating: 4.4,
      source: 'FIELD',
      fleetCount: 14,
      constitution: 'Proprietorship',
      kyc: [
        { kind: 'PAN', valueMasked: 'AAKCR2148L', route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(4) },
        { kind: 'AADHAAR', valueMasked: '4471', route: 'API', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(4) },
        { kind: 'ADDRESS', valueMasked: 'Electricity bill · Jul 26', route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(4) },
        { kind: 'SELFIE', valueMasked: '19.9975, 73.7898', geo: { lat: 19.9975, lng: 73.7898 }, route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(4) },
      ],
      documents: [
        { kind: 'RC', reference: 'MH15GT4482', status: 'VERIFIED', validTo: '2027-06-30', attachmentId: 'att-v-rc' },
        { kind: 'UDYAM', reference: 'UDYAM-MH-18-0044213', status: 'PENDING', validTo: null, attachmentId: 'att-v-udyam' },
        { kind: 'TDS_DECLARATION', reference: 'FY 2026-27', status: 'VERIFIED', validTo: '2027-03-31', attachmentId: 'att-v-tds' },
        { kind: 'BANK_STATEMENT', reference: 'HDFC ••4471', status: 'VERIFIED', validTo: null, attachmentId: 'att-v-bank' },
        { kind: 'TRANSPORTER_AGREEMENT', reference: null, status: 'MISSING', validTo: null, attachmentId: null },
      ],
      advanceHistory: [
        { oldPct: null, newPct: 40, changedBy: 'Meera Iyer', changedAt: '2024-03-11', approvalId: null },
      ],
      business: {
        trips: 41,
        revenuePaise: 189400000,
        marginPaise: 24100000,
        advanceOutstandingPaise: 2336000,
        balancePendingPaise: 3504000,
        penaltiesAccruedPaise: 40000,
        topLanes: [
          { lane: 'Nashik → Kolkata', trips: 12, marginPct: 13.1 },
          { lane: 'Nashik → Indore', trips: 9, marginPct: 15.4 },
          { lane: 'Nashik → Raipur', trips: 7, marginPct: 9.2 },
        ],
      },
      fleet: [
        { registration: 'MH 15 GT 4482', type: '32 ft SXL', capacityTn: 21, bodyType: 'Closed', currentCity: 'Kolkata', status: 'ON_TRIP' },
        { registration: 'MH 15 GT 4483', type: '22 ft', capacityTn: 9, bodyType: 'Open', currentCity: 'Nashik', status: 'AVAILABLE' },
        { registration: 'MH 15 GT 4490', type: '32 ft SXL', capacityTn: 21, bodyType: 'Closed', currentCity: 'Nashik', status: 'DOCS_DUE' },
      ],
    },
    {
      id: 'v-2287',
      code: 'VND-2287',
      legalName: 'Sai Kripa Carriers',
      partyType: 'OWNER',
      baseCity: 'Pune',
      branchId: 'br-pun',
      branchName: 'Pune',
      gstin: '27AALCS8841P1ZQ',
      pan: 'AALCS8841P',
      phone: '9822088411',
      altPhone: null,
      truckTypes: ['40 ft trailer'],
      operatingStates: ['MH', 'GJ'],
      advancePct: 40,
      bankAccount: '••8841',
      ifsc: 'ICIC0000442',
      accountHolder: 'Sai Kripa Carriers',
      status: 'PENDING_VERIFICATION',
      verifiedBy: null,
      panelDate: '2025-11-02',
      rating: 4.1,
      source: 'REFERRAL',
      fleetCount: 6,
      constitution: 'Proprietorship',
      kyc: [
        { kind: 'PAN', valueMasked: 'AALCS8841P', route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(2) },
        { kind: 'AADHAAR', valueMasked: '8841', route: 'API', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(2) },
        { kind: 'ADDRESS', valueMasked: 'Rent agreement · Sep 25', route: 'MANUAL', status: 'PENDING', verifiedBy: null, verifiedAt: null },
        { kind: 'SELFIE', valueMasked: '18.5204, 73.8567', geo: { lat: 18.5204, lng: 73.8567 }, route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(2) },
      ],
      documents: [
        { kind: 'RC', reference: 'MH12QR8841', status: 'VERIFIED', validTo: '2028-01-31', attachmentId: 'att-v2-rc' },
        { kind: 'TDS_DECLARATION', reference: 'FY 2026-27', status: 'VERIFIED', validTo: '2027-03-31', attachmentId: 'att-v2-tds' },
        { kind: 'BANK_STATEMENT', reference: 'Cheque photo illegible', status: 'REJECTED', validTo: null, attachmentId: 'att-v2-bank' },
      ],
      advanceHistory: [],
      business: {
        trips: 12,
        revenuePaise: 41200000,
        marginPaise: 4100000,
        advanceOutstandingPaise: 0,
        balancePendingPaise: 1860000,
        penaltiesAccruedPaise: 110000,
        topLanes: [{ lane: 'Pune → Surat', trips: 6, marginPct: 10.2 }],
      },
      fleet: [],
    },
    {
      id: 'v-2301',
      code: 'VND-2301',
      legalName: 'Bhagwati Logistics',
      partyType: 'VENDOR',
      baseCity: 'Hosur',
      branchId: 'br-hsr',
      branchName: 'Hosur',
      gstin: '33AAFCB2019H1ZT',
      pan: 'AAFCB2019H',
      phone: '9944020191',
      altPhone: null,
      truckTypes: ['Open body', '32 ft SXL'],
      operatingStates: ['TN', 'KA', 'HR'],
      advancePct: 70,
      bankAccount: '••2019',
      ifsc: 'SBIN0004471',
      accountHolder: 'Bhagwati Logistics',
      status: 'ACTIVE',
      verifiedBy: 'Meera Iyer',
      panelDate: '2025-02-18',
      rating: 4.6,
      source: 'MARKET_GAP',
      fleetCount: 22,
      constitution: 'Private limited',
      kyc: [
        { kind: 'PAN', valueMasked: 'AAFCB2019H', route: 'API', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(120) },
        { kind: 'AADHAAR', valueMasked: '2019', route: 'API', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(120) },
        { kind: 'ADDRESS', valueMasked: 'Electricity bill · Jan 25', route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(120) },
        { kind: 'SELFIE', valueMasked: '12.7409, 77.8253', geo: { lat: 12.7409, lng: 77.8253 }, route: 'MANUAL', status: 'VERIFIED', verifiedBy: 'Meera Iyer', verifiedAt: daysAgo(120) },
      ],
      documents: [
        { kind: 'RC', reference: 'MH04TT2019', status: 'VERIFIED', validTo: '2029-04-30', attachmentId: 'att-v3-rc' },
        { kind: 'TRADE_LICENCE', reference: 'HSR/TL/2211', status: 'VERIFIED', validTo: '2027-03-31', attachmentId: 'att-v3-tl' },
        { kind: 'TDS_DECLARATION', reference: 'FY 2026-27', status: 'VERIFIED', validTo: '2027-03-31', attachmentId: 'att-v3-tds' },
        { kind: 'BANK_STATEMENT', reference: 'SBI ••2019', status: 'VERIFIED', validTo: null, attachmentId: 'att-v3-bank' },
        { kind: 'TRANSPORTER_AGREEMENT', reference: 'Signed 18 Feb 2025', status: 'VERIFIED', validTo: null, attachmentId: 'att-v3-ta' },
      ],
      advanceHistory: [
        { oldPct: null, newPct: 40, changedBy: 'Meera Iyer', changedAt: '2025-02-18', approvalId: null },
        { oldPct: 40, newPct: 70, changedBy: 'Meera Iyer', changedAt: '2025-09-04', approvalId: 'apr-old-1' },
      ],
      business: {
        trips: 96,
        revenuePaise: 512000000,
        marginPaise: 71400000,
        advanceOutstandingPaise: 0,
        balancePendingPaise: 4120000,
        penaltiesAccruedPaise: 0,
        topLanes: [{ lane: 'Hosur → Gurugram', trips: 31, marginPct: 14.8 }],
      },
      fleet: [],
    },
  ] as Record<string, any>[],

  leads: [
    { id: 'l-1', code: 'LD-0084', name: 'Deshpande Carriers', city: 'Nashik', source: 'FIELD', partyType: 'OWNER', trucksClaimed: 4, phone: '9822011234', stage: 'QUALIFIED', notes: 'Runs Nashik → Nagpur weekly.' },
    { id: 'l-2', code: 'LD-0085', name: 'Yash Transport', city: 'Pune', source: 'REFERRAL', partyType: 'VENDOR', trucksClaimed: 11, phone: '9822055667', stage: 'DOCUMENTS_REQUESTED', notes: 'Asked for RC and PAN twice.' },
    { id: 'l-3', code: 'LD-0086', name: 'Sri Lakshmi Roadways', city: 'Vijayawada', source: 'MARKET_GAP', partyType: 'OWNER', trucksClaimed: 3, phone: '9440011223', stage: 'CONTACTED', notes: 'Vijayawada → Hyderabad gap.' },
    { id: 'l-4', code: 'LD-0087', name: 'Kutch Freight Lines', city: 'Gandhidham', source: 'FIELD', partyType: 'VENDOR', trucksClaimed: 18, phone: '9825044556', stage: 'NEW', notes: '' },
  ] as Record<string, any>[],

  marketGap: [
    { id: 'mg-1', branchId: 'br-nsk', branchName: 'Nashik', lane: 'Nashik → Kolkata', truckType: '32 ft SXL', target: 8, onPanel: 3, converted: 1 },
    { id: 'mg-2', branchId: 'br-vja', branchName: 'Vijayawada', lane: 'Vijayawada → Hyderabad', truckType: '22 ft container', target: 6, onPanel: 1, converted: 0 },
    { id: 'mg-3', branchId: 'br-gdm', branchName: 'Gandhidham', lane: 'Mundra → Jaipur', truckType: '40 ft trailer', target: 5, onPanel: 4, converted: 3 },
    { id: 'mg-4', branchId: 'br-hsr', branchName: 'Hosur', lane: 'Hosur → Gurugram', truckType: '32 ft SXL', target: 7, onPanel: 6, converted: 5 },
  ] as Record<string, any>[],

  issues: [
    { id: 'is-1', code: 'IS-0041', vendorId: 'v-2214', vendorName: 'Rathod Roadlines', category: 'POD_DELAY', severity: 'HIGH', tripCode: 'TRP-120881', raisedBy: 'Anil Deshmukh', raisedAt: daysAgo(6), status: 'OPEN', note: 'POD not couriered 24 days after delivery.' },
    { id: 'is-2', code: 'IS-0042', vendorId: 'v-2287', vendorName: 'Sai Kripa Carriers', category: 'VEHICLE_CONDITION', severity: 'MEDIUM', tripCode: 'TRP-120874', raisedBy: 'Sunita Rao', raisedAt: daysAgo(11), status: 'IN_PROGRESS', note: 'Tarpaulin torn, consignment wet at delivery.' },
    { id: 'is-3', code: 'IS-0043', vendorId: 'v-2214', vendorName: 'Rathod Roadlines', category: 'DRIVER_CONDUCT', severity: 'LOW', tripCode: null, raisedBy: 'Meera Iyer', raisedAt: daysAgo(20), status: 'RESOLVED', note: 'Driver refused to wait at consignee gate.' },
  ] as Record<string, any>[],

  clients: [
    {
      id: 'c-0092',
      code: 'CLT-0092',
      name: 'Berger Paints',
      billingCity: 'Kolkata',
      gstin: '19AAACB2545C1Z9',
      contact: 'A. Bose',
      phone: '9830011223',
      email: 'logistics@berger.example',
      engagement: 'CONTRACT',
      agreementNo: 'BRG/RC/2026-27',
      validFrom: '2026-04-01',
      validTo: '2027-03-31',
      creditDays: 45,
      serviceLevel: 'Same day placement',
      status: 'ACTIVE',
      outstandingPaise: 84200000,
    },
    {
      id: 'c-0088',
      code: 'CLT-0088',
      name: 'Sanghvi Metals',
      billingCity: 'Vijayawada',
      gstin: '37AAECS9111M1Z4',
      contact: 'R. Sanghvi',
      phone: '9440022114',
      email: 'despatch@sanghvi.example',
      engagement: 'SPOT',
      agreementNo: null,
      validFrom: null,
      validTo: null,
      creditDays: 30,
      serviceLevel: 'Next day placement',
      status: 'ACTIVE',
      outstandingPaise: 21400000,
    },
    {
      // Mid-onboarding: papers partly in, one rejected. The interesting case —
      // it exercises the checklist, the reject reason and the refusal to
      // clear a client who still owes something.
      id: 'c-0101',
      code: 'CLT-0101',
      name: 'Mahalaxmi Textiles',
      billingCity: 'Surat',
      gstin: '24AABCM4471P1ZQ',
      contact: 'H. Mehta',
      phone: '9825541120',
      email: 'accounts@mahalaxmi.example',
      engagement: 'CONTRACT',
      agreementNo: 'MLT/RC/2026',
      validFrom: '2026-02-01',
      validTo: '2027-01-31',
      creditDays: 45,
      serviceLevel: 'Scheduled',
      status: 'PENDING_VERIFICATION',
      createdAt: daysAgo(9),
      documents: [
        { kind: 'GST_CERTIFICATE', status: 'VERIFIED', reference: '24AABCM4471P1ZQ', verifiedByName: 'Meera Iyer', verifiedAt: daysAgo(5) },
        { kind: 'PAN', status: 'PENDING', reference: 'AABCM4471P' },
        { kind: 'CREDIT_CHECK', status: 'REJECTED', reference: 'Bureau report', rejectReason: 'Report is 14 months old — we need one inside 6 months.', verifiedByName: 'Meera Iyer', verifiedAt: daysAgo(2) },
      ],
      outstandingPaise: 0,
    },
    {
      // Just signed up by Finance, no papers yet.
      id: 'c-0102',
      code: 'CLT-0102',
      name: 'Konkan Agro Exports',
      billingCity: 'Ratnagiri',
      gstin: '27AACCK9902J1Z8',
      contact: 'S. Kadam',
      phone: '9422118876',
      email: 'logistics@konkanagro.example',
      engagement: 'SPOT',
      agreementNo: null,
      validFrom: null,
      validTo: null,
      creditDays: 15,
      serviceLevel: null,
      status: 'DRAFT',
      createdAt: daysAgo(2),
      documents: [],
      outstandingPaise: 0,
    },
    {
      id: 'c-0090',
      code: 'CLT-0090',
      name: 'Apex Ceramics',
      billingCity: 'Gandhidham',
      gstin: '24AAFCA7712R1ZK',
      contact: 'D. Patel',
      phone: '9825066771',
      email: 'ops@apexceramics.example',
      engagement: 'CONTRACT',
      agreementNo: 'APX/RC/2026',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      creditDays: 60,
      serviceLevel: 'Scheduled',
      status: 'ACTIVE',
      outstandingPaise: 39600000,
    },
  ] as Record<string, any>[],

  rateCards: {
    'c-0092': [
      { id: 'rc-1', rfqLaneId: 'rl-1', origin: 'Kolkata', destination: 'Nashik', truckType: '32 ft SXL', ratePaise: 6420000, transitDays: 5, reportingRule: 'NEXT_DAY', validFrom: '2026-04-01', validTo: '2027-03-31' },
      { id: 'rc-2', rfqLaneId: 'rl-2', origin: 'Kolkata', destination: 'Guwahati', truckType: '22 ft container', ratePaise: 3880000, transitDays: 3, reportingRule: 'SAME_DAY', validFrom: '2026-04-01', validTo: '2027-03-31' },
    ],
    /*
     * Two rows for one route, and that is the point. `rc-3` is the rate agreed
     * in January, closed on 30 June; `rc-4` is what replaced it from 1 July.
     * The periods abut and never overlap, so "what did we agree for a pickup
     * on this date" has exactly one answer — see `rate-revision.ts`.
     */
    'c-0090': [
      { id: 'rc-3', rfqLaneId: 'rl-9', origin: 'Mundra', destination: 'Jaipur', truckType: '40 ft trailer', ratePaise: 5210000, transitDays: 2, reportingRule: 'SAME_DAY', validFrom: '2026-01-01', validTo: '2026-06-30' },
      { id: 'rc-4', rfqLaneId: 'rl-9', origin: 'Mundra', destination: 'Jaipur', truckType: '40 ft trailer', ratePaise: 5390000, transitDays: 2, reportingRule: 'SAME_DAY', validFrom: '2026-07-01', validTo: '2026-12-31' },
    ],
  } as Record<string, any[]>,

  indents: [
    // These three back trips t-120874/t-120869/t-120855, which already
    // reference them by id and code. Without a matching indent record here,
    // every "Indent" related-record link from those trips (and from their
    // orders) 404s with "Indent IND-xxxx not found" — the indent side of the
    // seed data was never filled in to match. Unshifted (not appended) so
    // the existing ORD-000NN numbering below, which is derived from array
    // position, doesn't shift for the indents that already worked.
    {
      id: 'i-4440',
      code: 'IND-4440',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      branchId: 'br-pun',
      branchName: 'Pune',
      fromCity: 'Pune',
      toCity: 'Surat',
      material: 'Paint drums',
      weightTn: 9,
      truckType: '22 ft container',
      pickupDate: daysAgo(33),
      transitDays: 2,
      reportingRule: 'NEXT_DAY',
      remarks: '',
      sellRatePaise: 2240000,
      buyRatePaise: 1860000,
      rateSource: 'SPOT',
      rateCardLaneId: null,
      sourcingRatePaise: 1860000,
      spotConfirmationAttachmentId: 'att-spot-4440',
      bidMinPaise: 1750000,
      bidMaxPaise: 1950000,
      bandLocked: true,
      advancePct: 40,
      stage: 'TRIP_CREATED',
      vendorId: 'v-2287',
      awardedQuoteId: 'q-10',
      vehicleNo: 'MH 12 QR 8841',
      driverName: 'R. Pawar',
      driverLicence: 'MH12 20160008841',
      reportedAt: daysAgo(33),
      failureCause: null,
      distanceKm: 452,
      quotes: [],
    },
    {
      id: 'i-4436',
      code: 'IND-4436',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      branchId: 'br-hsr',
      branchName: 'Hosur',
      fromCity: 'Hosur',
      toCity: 'Gurugram',
      material: 'Ceramic tiles',
      weightTn: 20,
      truckType: '32 ft SXL',
      pickupDate: daysAgo(21),
      transitDays: 5,
      reportingRule: 'SAME_DAY',
      remarks: '',
      sellRatePaise: 4790000,
      buyRatePaise: 4120000,
      rateSource: 'SPOT',
      rateCardLaneId: null,
      sourcingRatePaise: 4120000,
      spotConfirmationAttachmentId: 'att-spot-4436',
      bidMinPaise: 3900000,
      bidMaxPaise: 4300000,
      bandLocked: true,
      advancePct: 40,
      stage: 'TRIP_CREATED',
      vendorId: 'v-2301',
      awardedQuoteId: 'q-11',
      vehicleNo: 'MH 04 TT 2019',
      driverName: 'K. Murugan',
      driverLicence: 'TN70 20170002019',
      reportedAt: daysAgo(21),
      failureCause: null,
      distanceKm: 2110,
      quotes: [],
    },
    {
      id: 'i-4421',
      code: 'IND-4421',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      branchId: 'br-gdm',
      branchName: 'Gandhidham',
      fromCity: 'Gandhidham',
      toCity: 'Jaipur',
      material: 'Ceramic tiles',
      weightTn: 24,
      truckType: '40 ft trailer',
      pickupDate: daysAgo(5),
      transitDays: 2,
      reportingRule: 'SAME_DAY',
      remarks: '',
      sellRatePaise: 3480000,
      buyRatePaise: 2940000,
      rateSource: 'SPOT',
      rateCardLaneId: null,
      sourcingRatePaise: 2940000,
      spotConfirmationAttachmentId: 'att-spot-4421',
      bidMinPaise: 2800000,
      bidMaxPaise: 3100000,
      bandLocked: true,
      advancePct: 40,
      stage: 'TRIP_CREATED',
      vendorId: 'v-2301',
      awardedQuoteId: 'q-12',
      vehicleNo: 'GJ 12 AT 7745',
      driverName: 'H. Solanki',
      driverLicence: 'GJ12 20150007745',
      reportedAt: daysAgo(5),
      failureCause: null,
      distanceKm: 941,
      quotes: [],
    },
    {
      id: 'i-4471',
      code: 'IND-4471',
      clientId: 'c-0088',
      clientName: 'Sanghvi Metals',
      branchId: 'br-vja',
      branchName: 'Vijayawada',
      fromCity: 'Bhiwandi',
      toCity: 'Hyderabad',
      material: 'CR steel coils',
      weightTn: 21,
      truckType: '32 ft SXL',
      pickupDate: daysAhead(1),
      transitDays: 2,
      reportingRule: 'SAME_DAY',
      remarks: 'Coils must be chocked. Consignee gate closes 18:00.',
      sellRatePaise: 4680000,
      buyRatePaise: null,
      rateSource: 'SPOT',
      rateCardLaneId: null,
      sourcingRatePaise: 4020000,
      spotConfirmationAttachmentId: 'att-spot-4471',
      bidMinPaise: 3800000,
      bidMaxPaise: 4250000,
      bandLocked: true,
      advancePct: 40,
      stage: 'OPEN',
      vendorId: null,
      awardedQuoteId: null,
      vehicleNo: null,
      driverName: null,
      driverLicence: null,
      reportedAt: null,
      failureCause: null,
      distanceKm: 712,
      quotes: [
        { id: 'q-1', code: 'BID-9908', vendorId: 'v-2214', vendorName: 'Rathod Roadlines', vendorStatus: 'PENDING_VERIFICATION', amountPaise: 4020000, truckRegistration: 'MH 15 GT 4482', bandPosition: 'IN_BAND', status: 'SUBMITTED', submittedAt: daysAgo(1), remarks: '' },
        { id: 'q-2', code: 'BID-9909', vendorId: 'v-2287', vendorName: 'Sai Kripa Carriers', vendorStatus: 'PENDING_VERIFICATION', amountPaise: 4180000, truckRegistration: 'MH 12 QR 8841', bandPosition: 'IN_BAND', status: 'SUBMITTED', submittedAt: daysAgo(1), remarks: '' },
        { id: 'q-3', code: 'BID-9910', vendorId: 'v-2301', vendorName: 'Bhagwati Logistics', vendorStatus: 'ACTIVE', amountPaise: 4450000, truckRegistration: 'MH 04 TT 2019', bandPosition: 'ABOVE_BAND', status: 'SUBMITTED', submittedAt: daysAgo(0), remarks: 'Return load not available.' },
      ],
    },
    {
      id: 'i-4468',
      code: 'IND-4468',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      branchId: 'br-pun',
      branchName: 'Pune',
      fromCity: 'Chakan',
      toCity: 'Coimbatore',
      material: 'Paint drums',
      weightTn: 14,
      truckType: '22 ft container',
      pickupDate: daysAgo(1),
      transitDays: 3,
      reportingRule: 'NEXT_DAY',
      remarks: '',
      sellRatePaise: 3900000,
      buyRatePaise: null,
      rateSource: 'CONTRACT',
      rateCardLaneId: 'rc-2',
      sourcingRatePaise: null,
      spotConfirmationAttachmentId: null,
      bidMinPaise: 3000000,
      bidMaxPaise: 3300000,
      bandLocked: true,
      advancePct: 40,
      stage: 'OPEN',
      vendorId: null,
      awardedQuoteId: null,
      vehicleNo: null,
      driverName: null,
      driverLicence: null,
      reportedAt: null,
      failureCause: 'ONLY_ABOVE_BAND_QUOTES',
      distanceKm: 1180,
      quotes: [
        { id: 'q-4', code: 'BID-9901', vendorId: 'v-2301', vendorName: 'Bhagwati Logistics', vendorStatus: 'ACTIVE', amountPaise: 3580000, truckRegistration: 'MH 04 TT 2088', bandPosition: 'ABOVE_BAND', status: 'SUBMITTED', submittedAt: daysAgo(2), remarks: '' },
      ],
    },
    {
      id: 'i-4462',
      code: 'IND-4462',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      branchId: 'br-gdm',
      branchName: 'Gandhidham',
      fromCity: 'Mundra',
      toCity: 'Jaipur',
      material: 'Ceramic tiles',
      weightTn: 25,
      truckType: '40 ft trailer',
      pickupDate: daysAhead(2),
      transitDays: 2,
      reportingRule: 'SAME_DAY',
      remarks: '',
      // Picks up in two days, so it is priced under the CURRENT rate — `rc-4`,
      // the successor the July revision created — not the closed `rc-3` it
      // used to point at. `rate-cross-check.ts` measures against the lane in
      // force on the pickup date, and would refuse this indent otherwise.
      sellRatePaise: 5390000,
      buyRatePaise: null,
      rateSource: 'CONTRACT',
      rateCardLaneId: 'rc-4',
      sourcingRatePaise: null,
      spotConfirmationAttachmentId: null,
      bidMinPaise: 4200000,
      bidMaxPaise: 4700000,
      bandLocked: true,
      advancePct: 40,
      stage: 'OPEN',
      vendorId: null,
      awardedQuoteId: null,
      vehicleNo: null,
      driverName: null,
      driverLicence: null,
      reportedAt: null,
      failureCause: null,
      distanceKm: 941,
      quotes: [],
    },
    {
      id: 'i-4443',
      code: 'IND-4443',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      branchId: 'br-nsk',
      branchName: 'Nashik',
      fromCity: 'Nashik',
      toCity: 'Kolkata',
      material: 'Paint drums',
      weightTn: 19,
      truckType: '32 ft SXL',
      pickupDate: daysAgo(26),
      transitDays: 5,
      reportingRule: 'NEXT_DAY',
      remarks: 'Stack no more than three high.',
      sellRatePaise: 6420000,
      buyRatePaise: 5840000,
      rateSource: 'CONTRACT',
      rateCardLaneId: 'rc-1',
      sourcingRatePaise: null,
      spotConfirmationAttachmentId: null,
      bidMinPaise: 5500000,
      bidMaxPaise: 6000000,
      bandLocked: true,
      advancePct: 40,
      stage: 'TRIP_CREATED',
      vendorId: 'v-2214',
      awardedQuoteId: 'q-0',
      vehicleNo: 'MH 15 GT 4482',
      driverName: 'Sandeep Rathod',
      driverLicence: 'MH15 20180004471',
      reportedAt: daysAgo(26),
      failureCause: null,
      distanceKm: 1912,
      quotes: [],
    },
  ] as Record<string, any>[],

  trips: [
    {
      id: 't-120881',
      code: 'TRP-120881',
      indentId: 'i-4443',
      indentCode: 'IND-4443',
      lrCode: 'LR-88214',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      vendorId: 'v-2214',
      vendorName: 'Rathod Roadlines',
      branchId: 'br-nsk',
      branchName: 'Nashik',
      vehicleNo: 'MH 15 GT 4482',
      vehicleType: '32 ft SXL',
      capacityTn: 21,
      driverName: 'Sandeep Rathod',
      driverLicence: 'MH15 20180004471',
      driverPhone: '9822014479',
      lane: 'Nashik → Kolkata',
      distanceKm: 1912,
      weightTn: 19,
      transitDaysRequired: 5,
      actualTransitDays: 6,
      transitDelay: true,
      remarks: 'Stack no more than three high.',
      buyRatePaise: 5840000,
      sellRatePaise: 6420000,
      ewayNo: null,
      ewayValidTill: null,
      stage: 'DELIVERED',
      deliveredAt: daysAgo(24),
      podStatus: 'PENDING',
      podReceivedAt: null,
      podPenaltyPaise: 40000,
      podClosureBasis: null,
      advancePaidPaise: 0,
      balancePaidPaise: 0,
      billed: false,
      documents: tripDocs(),
      charges: [
        { id: 'ch-1', chargeType: 'LOADING', costAmountPaise: 180000, billedAmountPaise: 220000, capturedBy: 'Anil Deshmukh', capturedAt: daysAgo(25) },
      ],
      lr: {
        code: 'LR-88214',
        status: 'IN_TRANSIT',
        lrDate: daysAgo(26),
        bookedAt: daysAgo(26),
        sharedAt: null,
        consignor: { name: 'Berger Paints', address: 'MIDC Satpur, Nashik', gstin: '27AAACB2545C1Z9' },
        consignee: { name: 'Berger Paints Depot', address: 'Dum Dum, Kolkata', gstin: '19AAACB2545C1Z9' },
        goods: { description: 'Paint drums', packages: 420, weightTn: 19, valuePaise: 1840000 },
        invoice: { number: 'SM/26/1189', datedOn: daysAgo(26), valuePaise: 1840000 },
        eway: { number: '', validTill: '' },
        vehicle: { registration: 'MH 15 GT 4482', type: '32 ft SXL' },
        driver: { name: 'Sandeep Rathod', licence: 'MH15 20180004471', phone: '9822014479' },
        transitDays: 5,
        remarks: 'Stack no more than three high.',
        chargeHeads: { freightPaise: 6420000, loadingPaise: 220000, unloadingPaise: 0, detentionPaise: 0, otherPaise: 0, discountPaise: 0 },
      },
    },
    {
      id: 't-120874',
      code: 'TRP-120874',
      indentId: 'i-4440',
      indentCode: 'IND-4440',
      lrCode: 'LR-88207',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      vendorId: 'v-2287',
      vendorName: 'Sai Kripa Carriers',
      branchId: 'br-pun',
      branchName: 'Pune',
      vehicleNo: 'MH 12 QR 8841',
      vehicleType: '22 ft',
      capacityTn: 9,
      driverName: 'R. Pawar',
      driverLicence: 'MH12 20160008841',
      driverPhone: '9822088419',
      lane: 'Pune → Surat',
      distanceKm: 452,
      weightTn: 9,
      transitDaysRequired: 2,
      actualTransitDays: 2,
      transitDelay: false,
      remarks: '',
      buyRatePaise: 1860000,
      sellRatePaise: 2240000,
      ewayNo: 'EWB271144718842',
      ewayValidTill: daysAgo(29),
      stage: 'DELIVERED',
      deliveredAt: daysAgo(31),
      podStatus: 'ATTACHED',
      podReceivedAt: null,
      podPenaltyPaise: 110000,
      podClosureBasis: null,
      advancePaidPaise: 744000,
      balancePaidPaise: 0,
      billed: false,
      documents: [],
      charges: [],
      lr: null,
    },
    {
      id: 't-120869',
      code: 'TRP-120869',
      indentId: 'i-4436',
      indentCode: 'IND-4436',
      lrCode: 'LR-88201',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      vendorId: 'v-2301',
      vendorName: 'Bhagwati Logistics',
      branchId: 'br-hsr',
      branchName: 'Hosur',
      vehicleNo: 'MH 04 TT 2019',
      vehicleType: '32 ft SXL',
      capacityTn: 21,
      driverName: 'K. Murugan',
      driverLicence: 'TN70 20170002019',
      driverPhone: '9944020199',
      lane: 'Hosur → Gurugram',
      distanceKm: 2110,
      weightTn: 20,
      transitDaysRequired: 5,
      actualTransitDays: 5,
      transitDelay: false,
      remarks: '',
      buyRatePaise: 4120000,
      sellRatePaise: 4790000,
      ewayNo: 'EWB331144712019',
      ewayValidTill: daysAhead(2),
      stage: 'IN_TRANSIT',
      deliveredAt: daysAgo(16),
      podStatus: 'RECEIVED',
      podReceivedAt: daysAgo(2),
      podPenaltyPaise: 0,
      podClosureBasis: null,
      advancePaidPaise: 2884000,
      balancePaidPaise: 0,
      billed: false,
      documents: [],
      charges: [],
      lr: null,
    },
    {
      id: 't-120855',
      code: 'TRP-120855',
      indentId: 'i-4421',
      indentCode: 'IND-4421',
      lrCode: 'LR-88188',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      vendorId: 'v-2301',
      vendorName: 'Anand Roadways',
      branchId: 'br-gdm',
      branchName: 'Gandhidham',
      vehicleNo: 'GJ 12 AT 7745',
      vehicleType: '40 ft trailer',
      capacityTn: 25,
      driverName: 'H. Solanki',
      driverLicence: 'GJ12 20150007745',
      driverPhone: '9825077451',
      lane: 'Gandhidham → Jaipur',
      distanceKm: 941,
      weightTn: 24,
      transitDaysRequired: 2,
      actualTransitDays: 2,
      transitDelay: false,
      remarks: '',
      buyRatePaise: 2940000,
      sellRatePaise: 3480000,
      ewayNo: 'EWB241144717745',
      ewayValidTill: daysAgo(1),
      stage: 'DELIVERED',
      deliveredAt: daysAgo(3),
      podStatus: 'APPROVED',
      podReceivedAt: daysAgo(2),
      podPenaltyPaise: 0,
      podClosureBasis: null,
      advancePaidPaise: 1176000,
      balancePaidPaise: 0,
      billed: false,
      documents: [],
      charges: [
        { id: 'ch-2', chargeType: 'UNLOADING', costAmountPaise: 140000, billedAmountPaise: 175000, capturedBy: 'Sunita Rao', capturedAt: daysAgo(2) },
      ],
      lr: null,
    },
  ] as Record<string, any>[],

  podReceipts: [] as Record<string, any>[],
  payments: [] as Record<string, any>[],

  vendorBills: [
    {
      id: 'vb-1',
      tripId: 't-120855',
      tripCode: 'TRP-120855',
      vendorId: 'v-2301',
      vendorName: 'Anand Roadways',
      billNo: 'AR/26/0221',
      billDate: daysAgo(1),
      attachmentId: 'att-bill-1',
      freightPaise: 2940000,
      chargesPaise: 140000,
      totalPaise: 3080000,
      submittedAt: daysAgo(1),
      computedBalancePaise: 1904000,
      variancePaise: 0,
      podStatus: 'APPROVED',
      status: 'SUBMITTED',
    },
    {
      id: 'vb-2',
      tripId: 't-120869',
      tripCode: 'TRP-120869',
      vendorId: 'v-2301',
      vendorName: 'Bhagwati Logistics',
      billNo: 'BL/26/1180',
      billDate: daysAgo(0),
      attachmentId: 'att-bill-2',
      freightPaise: 4120000,
      chargesPaise: 90000,
      totalPaise: 4210000,
      submittedAt: daysAgo(0),
      computedBalancePaise: 1236000,
      variancePaise: 90000,
      podStatus: 'RECEIVED',
      status: 'SUBMITTED',
    },
  ] as Record<string, any>[],

  invoices: [
    {
      id: 'inv-411',
      code: 'NEX-INV-000411',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      invoiceDate: daysAgo(20),
      dueDate: daysAhead(25),
      tripIds: ['t-120874'],
      freightPaise: 2240000,
      loadingPaise: 0,
      unloadingPaise: 0,
      detentionPaise: 0,
      otherPaise: 0,
      discountPaise: 0,
      roundOffPaise: 0,
      totalPaise: 2240000,
      receivedPaise: 1000000,
      taxMechanism: 'REVERSE_CHARGE',
      status: 'PART_PAID',
      cancelReason: null,
      notes: '',
    },
    {
      id: 'inv-410',
      code: 'NEX-INV-000410',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      invoiceDate: daysAgo(64),
      dueDate: daysAgo(4),
      tripIds: ['t-120855'],
      freightPaise: 3480000,
      loadingPaise: 0,
      unloadingPaise: 175000,
      detentionPaise: 0,
      otherPaise: 0,
      discountPaise: 0,
      roundOffPaise: 0,
      totalPaise: 3655000,
      receivedPaise: 0,
      taxMechanism: 'REVERSE_CHARGE',
      status: 'ISSUED',
      cancelReason: null,
      notes: '',
    },
  ] as Record<string, any>[],

  receipts: [
    { id: 'r-1', code: 'RCT-0330', invoiceId: 'inv-411', invoiceCode: 'NEX-INV-000411', clientId: 'c-0092', clientName: 'Berger Paints', amountPaise: 1000000, receivedOn: daysAgo(6), mode: 'NEFT', reference: 'HDFC26081144', remarks: '' },
  ] as Record<string, any>[],

  rfqs: [
    {
      id: 'rfq-1',
      clientId: 'c-0092',
      clientName: 'Berger Paints',
      cycleMonths: 12,
      periodFrom: '2027-04-01',
      periodTo: '2028-03-31',
      dueAt: daysAhead(9),
      reference: 'BRG/RFQ/27',
      status: 'SOURCING',
      submittedBy: null,
      submittedAt: null,
      lanes: [
        {
          id: 'rl-11',
          origin: 'Kolkata',
          destination: 'Nashik',
          truckType: '32 ft SXL',
          transitDays: 5,
          reportingRule: 'NEXT_DAY',
          sourcingMode: 'MONTHLY',
          sourcingRows: [
            { month: '2026-03', ratePaise: 5620000 },
            { month: '2026-04', ratePaise: 5710000 },
            { month: '2026-05', ratePaise: 5840000 },
          ],
          sourcingAvgPaise: 5723333,
          overheadPaise: 210000,
          marginPaise: 480000,
          quotedRatePaise: 6413333,
          outcome: null,
          awardedRatePaise: null,
        },
        {
          id: 'rl-12',
          origin: 'Kolkata',
          destination: 'Guwahati',
          truckType: '22 ft container',
          transitDays: 3,
          reportingRule: 'SAME_DAY',
          sourcingMode: 'HIGH_LOW',
          sourcingRows: [
            { month: null, ratePaise: 3400000 },
            { month: null, ratePaise: 3700000 },
          ],
          sourcingAvgPaise: 3550000,
          overheadPaise: 120000,
          marginPaise: 190000,
          quotedRatePaise: 3860000,
          outcome: null,
          awardedRatePaise: null,
        },
      ],
    },
    {
      id: 'rfq-2',
      clientId: 'c-0090',
      clientName: 'Apex Ceramics',
      cycleMonths: 6,
      periodFrom: '2027-01-01',
      periodTo: '2027-06-30',
      dueAt: daysAgo(4),
      reference: 'APX/RFQ/H1',
      status: 'SUBMITTED',
      submittedBy: 'Vikram Shah',
      submittedAt: daysAgo(4),
      lanes: [
        {
          id: 'rl-21',
          origin: 'Mundra',
          destination: 'Jaipur',
          truckType: '40 ft trailer',
          transitDays: 2,
          reportingRule: 'SAME_DAY',
          sourcingMode: 'MONTHLY',
          sourcingRows: [
            { month: '2026-05', ratePaise: 4720000 },
            { month: '2026-06', ratePaise: 4810000 },
          ],
          sourcingAvgPaise: 4765000,
          overheadPaise: 180000,
          marginPaise: 265000,
          quotedRatePaise: 5210000,
          outcome: null,
          awardedRatePaise: null,
        },
      ],
    },
  ] as Record<string, any>[],

  telematics: [
    { vehicleNo: 'MH 15 GT 4482', tripCode: 'TRP-120881', vendorName: 'Rathod Roadlines', lane: 'Nashik → Kolkata', progressPct: 100, speedKmph: 0, fuelPct: 34, lastPingAt: daysAgo(24), lat: 22.5726, lng: 88.3639, ewayValidTill: null, alerts: ['DARK_VEHICLE'] },
    { vehicleNo: 'MH 04 TT 2019', tripCode: 'TRP-120869', vendorName: 'Bhagwati Logistics', lane: 'Hosur → Gurugram', progressPct: 82, speedKmph: 91, fuelPct: 58, lastPingAt: new Date(Date.now() - 4 * 60000).toISOString(), lat: 26.9124, lng: 75.7873, ewayValidTill: daysAhead(2), alerts: ['OVERSPEED', 'EWAY_EXPIRING'] },
    { vehicleNo: 'GJ 12 AT 7745', tripCode: 'TRP-120855', vendorName: 'Anand Roadways', lane: 'Gandhidham → Jaipur', progressPct: 100, speedKmph: 0, fuelPct: 21, lastPingAt: new Date(Date.now() - 40 * 60000).toISOString(), lat: 26.9124, lng: 75.7873, ewayValidTill: daysAgo(1), alerts: ['LONG_HALT', 'EWAY_EXPIRED'] },
  ] as Record<string, any>[],

  /**
   * Rate changes asked for on a client's agreed lane price.
   *
   * Two seeded rows on purpose. `rr-1` is APPLIED and its successor lane
   * (`rc-4`) is live in `rateCards` beside the closed `rc-3`, so the screen
   * shows what a completed change actually leaves behind: two rows for one
   * route, with abutting periods and no overlap. `rr-2` is PENDING, so the
   * "waiting for sign-off" path has something in it without anybody having to
   * raise one first.
   */
  rateRevisions: [
    {
      id: 'rr-1',
      clientId: 'c-0092',
      fromLaneId: 'rc-2',
      toLaneId: null,
      status: 'PENDING',
      oldRatePaise: 3880000,
      newRatePaise: 4120000,
      effectiveFrom: daysAhead(7).slice(0, 10),
      reason: 'Diesel up 9% since April and the return load on this leg dried up after the Guwahati depot closed.',
      lane: 'Kolkata → Guwahati',
      truckType: '22 ft container',
      requestedByName: 'R. Iyer · Finance',
      createdAt: daysAgo(2),
    },
    {
      id: 'rr-2',
      clientId: 'c-0090',
      fromLaneId: 'rc-3',
      toLaneId: 'rc-4',
      status: 'APPLIED',
      oldRatePaise: 5210000,
      newRatePaise: 5390000,
      effectiveFrom: '2026-07-01',
      reason: 'Toll revision on the Mundra corridor from 1 July, passed through at cost as agreed.',
      lane: 'Mundra → Jaipur',
      truckType: '40 ft trailer',
      requestedByName: 'R. Iyer · Finance',
      createdAt: daysAgo(38),
    },
  ] as Record<string, any>[],

  /**
   * The audit trail. Written on every mutation in the real API since day one
   * and, until now, read by nothing — so the fixture never carried any.
   *
   * Seeded across four desks and both sides of the fence: one entry made by a
   * transporter through their own portal (`actorVendorId` set), one creation
   * with no `before`, and one money movement. Enough that the screen shows
   * what it is for rather than an empty state, and enough that the "who did
   * this, us or them" distinction is visible on arrival.
   */
  /**
   * Tickets — problems reported from the screen they were spotted on.
   *
   * Three seeded so the queue demonstrates its own shape rather than an empty
   * state: one blocking somebody's work, one being looked at, and one already
   * sorted with a note saying what was done. The closed one matters — a queue
   * that only ever shows open work does not show what an answer looks like.
   */
  tickets: [
    {
      id: 'tkt-1',
      code: 'TKT-0003',
      subject: 'Client name is spelt wrong on this bill',
      detail:
        'On invoice NEX-INV-000214 the client reads Bergar Paints. It should be Berger Paints, as on CLT-0092. The client has queried it.',
      kind: 'WRONG_DATA',
      severity: 'BLOCKING',
      status: 'OPEN',
      raisedOnPath: '/invoices',
      entityType: 'invoices',
      entityId: 'inv-214',
      resolution: null,
      resolvedAt: null,
      resolvedByName: null,
      createdAt: daysAgo(1),
      raisedBy: 'u-fin',
      raisedByName: 'Rakesh Nair',
      branchName: 'Nashik',
    },
    {
      id: 'tkt-2',
      code: 'TKT-0002',
      subject: 'Truck shows as available but it is off the road',
      detail:
        'MH 12 RB 7721 is still being offered on quotes. Its fitness certificate expired on 2 August and the transporter has not sent the new one.',
      kind: 'WRONG_DATA',
      severity: 'NORMAL',
      status: 'IN_PROGRESS',
      raisedOnPath: '/vendors',
      entityType: 'vendors',
      entityId: 'v-2214',
      resolution: null,
      resolvedAt: null,
      resolvedByName: null,
      createdAt: daysAgo(4),
      raisedBy: 'u-ops',
      raisedByName: 'Anil Deshmukh',
      branchName: 'Nashik',
    },
    {
      id: 'tkt-3',
      code: 'TKT-0001',
      subject: 'Pickup date on this load request is a day out',
      detail:
        'IND-4474 says pickup on the 30th. The client asked for the 29th and the truck is booked for the 29th.',
      kind: 'WRONG_DATA',
      severity: 'MINOR',
      status: 'RESOLVED',
      raisedOnPath: '/indents',
      entityType: 'indents',
      entityId: 'i-4474',
      resolution: 'Corrected the pickup date on IND-4474 to the 29th and told the branch.',
      resolvedAt: daysAgo(6),
      resolvedByName: 'S. Krishnan',
      createdAt: daysAgo(7),
      raisedBy: 'u-ops',
      raisedByName: 'Sunita Rao',
      branchName: 'Nashik',
    },
  ] as Record<string, any>[],

  auditEvents: [
    {
      id: 'ae-1',
      at: daysAgo(0),
      actorId: 'u-fin',
      actorName: 'R. Iyer',
      actorRole: 'FINANCE',
      actorVendorId: null,
      action: 'PAYMENT_RELEASED',
      entityType: 'payments',
      entityId: 'pay-2201',
      before: { status: 'PENDING' },
      after: { status: 'RELEASED', utr: 'HDFC0099231144' },
    },
    {
      id: 'ae-2',
      at: daysAgo(0),
      actorId: null,
      actorName: 'Rathod Roadlines',
      actorRole: 'VENDOR',
      // Done by a transporter on their own portal, not by one of our desks.
      // The first question asked of a disputed entry is which of the two it
      // was, so the fixture carries an example from the start.
      actorVendorId: 'v-2214',
      action: 'DOCUMENT_UPLOADED',
      entityType: 'trip_documents',
      entityId: 'td-88',
      before: null,
      after: { kind: 'LR_COPY', status: 'PENDING' },
    },
    {
      id: 'ae-3',
      at: daysAgo(1),
      actorId: 'u-cmp',
      actorName: 'S. Krishnan',
      actorRole: 'COMPLIANCE',
      actorVendorId: null,
      action: 'DOCUMENT_VERIFIED',
      entityType: 'vendor_documents',
      entityId: 'vd-14',
      before: { status: 'PENDING' },
      after: { status: 'VERIFIED' },
    },
    {
      id: 'ae-4',
      at: daysAgo(2),
      actorId: 'u-ops',
      actorName: 'Sunita Rao',
      actorRole: 'OPS',
      actorVendorId: null,
      action: 'CREATE',
      entityType: 'indents',
      entityId: 'i-4474',
      // A creation has no `before` — every field reads as newly set.
      before: null,
      after: { code: 'IND-4474', fromCity: 'Mundra', toCity: 'Jaipur', sellRatePaise: 5390000 },
    },
    {
      id: 'ae-5',
      at: daysAgo(30),
      actorId: 'u-lead',
      actorName: 'A. Menon',
      actorRole: 'LEADERSHIP',
      actorVendorId: null,
      action: 'RATE_REVISION_APPLIED',
      entityType: 'rate_card_lanes',
      entityId: 'rc-4',
      before: { laneId: 'rc-3', rate: 5210000, validTo: null },
      after: { laneId: 'rc-4', rate: 5390000, validFrom: '2026-07-01' },
    },
  ] as Record<string, any>[],

  importBatches: [
    { id: 'imp-1', set: 'clients', fileName: 'clients-2026-08.csv', fileHash: 'e3b0c44298fc1c14', rows: 38, rejected: 0, actor: 'S. Krishnan', committedAt: daysAgo(9), status: 'COMMITTED' },
  ] as Record<string, any>[],
};

export const helpers = { now, daysAgo, daysAhead };

/** Every business-record array in `db` — cleared by `resetToEmpty`. */
const TRANSACTIONAL_KEYS = [
  'approvals', 'vendors', 'leads', 'marketGap', 'issues', 'clients', 'indents',
  'trips', 'podReceipts', 'payments', 'vendorBills', 'invoices', 'receipts',
  'rfqs', 'telematics', 'importBatches', 'rateRevisions', 'auditEvents', 'tickets',
] as const;

/**
 * Wipes every seeded business record — vendors, clients, indents, trips,
 * invoices, approvals, the lot — for a manual "build everything from
 * scratch" test pass. Deliberately opt-in (called only from a UI action,
 * never on module load): the six dev users, branches and system config stay,
 * since those are what sign-in and every dropdown depend on, and e2e specs
 * that assert against the seeded fixtures never call this.
 */
export function resetToEmpty(): void {
  TRANSACTIONAL_KEYS.forEach((key) => {
    (db[key] as unknown[]).length = 0;
  });
  Object.keys(db.rateCards).forEach((key) => delete (db.rateCards as Record<string, unknown>)[key]);
  Object.keys(db.roleMatrix).forEach((key) => delete (db.roleMatrix as Record<string, unknown>)[key]);
  db.numberSeries.forEach((series) => {
    series.nextValue = 1;
  });
}

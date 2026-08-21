import { AxiosAdapter, AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { RoleCode, SEED_GRANTS } from '@/lib/permissions';
import { ADVANCE_DOCUMENT_SET, BRANCHES, DOC_LABEL, USERS, db, helpers } from './db';

/**
 * Fixture adapter — stands in for `internal-api` until it exists.
 *
 * It is deliberately a *contract mirror*, not a simulator: every response
 * here is the exact envelope, status code and field naming that
 * `docs/api/*.md` asks the backend for. When the backend lands, set
 * NEXT_PUBLIC_USE_MOCKS=0 and nothing in any page changes.
 *
 * Business rules are reproduced only where a screen would otherwise be
 * undemonstrable (the two money gates, the POD chain, approvals). The
 * server remains the authority; this is scaffolding with an expiry date.
 */

export const MOCKS_ENABLED =
  (process.env.NEXT_PUBLIC_USE_MOCKS ?? '1') !== '0';

interface Ctx {
  params: string[];
  query: URLSearchParams;
  body: any;
  role: RoleCode;
  headers: Record<string, any>;
}

type Result = any | { __status: number; body: any };
type Handler = (ctx: Ctx) => Result;

const ok = (data: any) => data;
const status = (code: number, body: any) => ({ __status: code, body });

class MockHttpError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const fail = (httpStatus: number, code: string, message: string, details?: unknown) => {
  throw new MockHttpError(httpStatus, code, message, details);
};

/* ---- helpers ------------------------------------------------------------ */

const findVendor = (idOrCode: string) =>
  db.vendors.find((v) => v.id === idOrCode || v.code === idOrCode) ??
  fail(404, 'NOT_FOUND', `Vendor ${idOrCode} not found`);

const findIndent = (idOrCode: string) =>
  db.indents.find((i) => i.id === idOrCode || i.code === idOrCode) ??
  fail(404, 'NOT_FOUND', `Indent ${idOrCode} not found`);

const findTrip = (idOrCode: string) =>
  db.trips.find((t) => t.id === idOrCode || t.code === idOrCode) ??
  fail(404, 'NOT_FOUND', `Trip ${idOrCode} not found`);

const findInvoice = (idOrCode: string) =>
  db.invoices.find((i) => i.id === idOrCode || i.code === idOrCode) ??
  fail(404, 'NOT_FOUND', `Invoice ${idOrCode} not found`);

const findRfq = (id: string) => db.rfqs.find((r) => r.id === id) ?? fail(404, 'NOT_FOUND', `RFQ ${id} not found`);

function nextNumber(key: string): string {
  const series = db.numberSeries.find((s) => s.key === key)!;
  const value = series.nextValue;
  series.nextValue += 1;
  return `${series.prefix}${String(value).padStart(series.width, '0')}`;
}

function raiseApproval(input: {
  kind: string;
  entityType: string;
  entityId: string;
  title: string;
  detail: string;
  amountPaise: number | null;
  approverRole: string;
  requiredPermission: string;
  reason: string;
  role: RoleCode;
}) {
  const approval = {
    id: `apr-${db.approvals.length + 1}-${Date.now()}`,
    kind: input.kind,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    detail: input.detail,
    amountPaise: input.amountPaise,
    requesterId: USERS[input.role].userId,
    requesterName: `${USERS[input.role].name} · ${input.role}`,
    approverRole: input.approverRole,
    requiredPermission: input.requiredPermission,
    reason: input.reason,
    status: 'PENDING',
    createdAt: helpers.now(),
  };
  db.approvals.unshift(approval);
  return status(202, { approvalRequired: true, approval });
}

/** BR-07 / BR-58 — the advance gate, computed from the document set. */
function advanceGate(trip: any) {
  const set: string[] = db.config.advance_document_set;
  const unmet = set
    .map((kind) => {
      const doc = trip.documents.find((d: any) => d.kind === kind);
      if (!doc || doc.status === 'MISSING')
        return { key: kind, label: `${DOC_LABEL[kind] ?? kind} not uploaded`, state: 'MISSING' as const };
      if (doc.status === 'REJECTED')
        return { key: kind, label: `${DOC_LABEL[kind] ?? kind} rejected`, state: 'REJECTED' as const };
      if (doc.status !== 'VERIFIED')
        return {
          key: kind,
          label: `${DOC_LABEL[kind] ?? kind} uploaded but not verified`,
          state: 'UNVERIFIED' as const,
        };
      return null;
    })
    .filter(Boolean) as { key: string; label: string; state: 'MISSING' | 'UNVERIFIED' | 'REJECTED' }[];

  const cleared = set
    .filter((kind) => trip.documents.find((d: any) => d.kind === kind)?.status === 'VERIFIED')
    .map((kind) => ({ key: kind, label: DOC_LABEL[kind] ?? kind }));

  const grossPaise = Math.round((trip.buyRatePaise * (trip.advancePct ?? 40)) / 100);
  return { unmet, cleared, grossPaise, tdsPaise: 0, netPaise: grossPaise };
}

/** BR-10 / BR-11 / BR-24 / BR-25 — the balance gate and its four lines. */
function balanceGate(trip: any) {
  const unmet: { key: string; label: string; state: 'MISSING' | 'UNVERIFIED' | 'BLOCKED' }[] = [];
  const podAgeDays = trip.deliveredAt
    ? Math.floor((Date.now() - new Date(trip.deliveredAt).getTime()) / 86_400_000)
    : 0;

  if (trip.stage !== 'DELIVERED' && trip.stage !== 'CLOSED')
    unmet.push({ key: 'DELIVERY', label: 'Trip not delivered', state: 'BLOCKED' });
  if (!['APPROVED', 'WAIVED'].includes(trip.podStatus))
    unmet.push({
      key: 'POD',
      label: `Proof of delivery is ${trip.podStatus.toLowerCase()}, not approved`,
      state: 'BLOCKED',
    });
  if (podAgeDays > db.config.pod_forfeit_days)
    unmet.push({ key: 'FORFEIT', label: `POD past ${db.config.pod_forfeit_days} days — balance forfeited`, state: 'BLOCKED' });

  const chargeCostPaise = (trip.charges ?? []).reduce((a: number, c: any) => a + c.costAmountPaise, 0);
  const billablePaise = trip.buyRatePaise + chargeCostPaise;
  const grossPaise = billablePaise - (trip.advancePaidPaise ?? 0);
  const penaltyPaise = trip.podStatus === 'WAIVED' ? 0 : (trip.podPenaltyPaise ?? 0);
  const netPaise = grossPaise - penaltyPaise;
  const penaltyDays = Math.max(0, podAgeDays - db.config.pod_tat_days);

  return {
    unmet,
    podAgeDays,
    breakdown: {
      billablePaise,
      buyRatePaise: trip.buyRatePaise,
      chargeCostPaise,
      advancePaidPaise: trip.advancePaidPaise ?? 0,
      penaltyPaise,
      penaltyDays,
      penaltyPerDayPaise: db.config.pod_penalty_per_day_paise,
      grossPaise,
      netPaise,
    },
  };
}

function tripSummary(t: any) {
  return {
    id: t.id,
    code: t.code,
    lrCode: t.lrCode,
    indentCode: t.indentCode,
    clientName: t.clientName,
    vendorName: t.vendorName,
    branchName: t.branchName,
    lane: t.lane,
    vehicleNo: t.vehicleNo,
    stage: t.stage,
    podStatus: t.podStatus,
    deliveredAt: t.deliveredAt,
    buyRatePaise: t.buyRatePaise,
    sellRatePaise: t.sellRatePaise,
    advancePaidPaise: t.advancePaidPaise,
    podPenaltyPaise: t.podPenaltyPaise,
  };
}

function scopeBranch(rows: any[], role: RoleCode) {
  if (role !== 'BRANCH_MGR') return rows;
  return rows.filter((r) => r.branchId === 'br-nsk' || r.branchName === 'Nashik');
}

/* ---- routes ------------------------------------------------------------- */

const routes: [string, RegExp, Handler][] = [
  /* ---------------------------------------------------------- session --- */
  [
    'GET',
    /^\/auth\/session$/,
    ({ role }) => {
      const user = USERS[role];
      return ok({
        userId: user.userId,
        name: user.name,
        email: user.email,
        role,
        permissions: SEED_GRANTS[role],
        branch: user.branch ? BRANCHES.find((b) => b.code === user.branch) : null,
      });
    },
  ],
  ['GET', /^\/branches$/, () => ok(BRANCHES)],
  ['GET', /^\/health$/, () => ok({ service: 'internal-api', status: 'ok', timestamp: helpers.now() })],

  /* ------------------------------------------------------------- C1 ----- */
  ['GET', /^\/config$/, () => ok(db.config)],
  [
    'PATCH',
    /^\/config$/,
    ({ body }) => {
      Object.assign(db.config, body);
      return ok(db.config);
    },
  ],
  ['GET', /^\/config\/number-series$/, () => ok(db.numberSeries)],
  [
    'PATCH',
    /^\/config\/number-series\/([^/]+)$/,
    ({ params, body }) => {
      const series = db.numberSeries.find((s) => s.key === params[0]) ?? fail(404, 'NOT_FOUND', 'Series not found');
      if (body.nextValue !== undefined && body.nextValue < series.nextValue)
        fail(409, 'SERIES_LOWERED', `A series cannot be lowered below its consumed value (${series.nextValue}).`);
      Object.assign(series, body);
      return ok(series);
    },
  ],
  [
    'GET',
    /^\/admin\/roles$/,
    () =>
      ok({
        roles: Object.keys(SEED_GRANTS),
        grants: SEED_GRANTS,
        matrix: db.roleMatrix,
      }),
  ],
  [
    'PATCH',
    /^\/admin\/roles\/([^/]+)\/permissions$/,
    ({ params, body }) => {
      const role = params[0] as RoleCode;
      if (body.permission === 'payment.release' && role !== 'FINANCE')
        fail(409, 'PERMISSION_FIXED', 'payment.release is FINANCE only and is not grantable to another role (BR-40).');
      db.roleMatrix[role] = { ...(db.roleMatrix[role] ?? {}), [body.permission]: body.level };
      return ok({ role, permission: body.permission, level: body.level });
    },
  ],
  [
    'GET',
    /^\/approvals$/,
    ({ query }) => {
      const wanted = query.get('status') ?? 'PENDING';
      const kind = query.get('kind');
      return ok(
        db.approvals.filter((a) => a.status === wanted && (!kind || a.kind === kind)),
      );
    },
  ],
  [
    'POST',
    /^\/approvals\/([^/]+)\/approve$/,
    ({ params, role }) => {
      const approval = db.approvals.find((a) => a.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Approval not found');
      approval.status = 'APPROVED';
      approval.approverId = USERS[role].userId;
      approval.decidedAt = helpers.now();
      return ok(approval);
    },
  ],
  [
    'POST',
    /^\/approvals\/([^/]+)\/reject$/,
    ({ params, body, role }) => {
      if (!body?.note?.trim()) fail(400, 'NOTE_REQUIRED', 'A note is required to reject an approval.');
      const approval = db.approvals.find((a) => a.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Approval not found');
      approval.status = 'REJECTED';
      approval.note = body.note;
      approval.approverId = USERS[role].userId;
      approval.decidedAt = helpers.now();
      return ok(approval);
    },
  ],
  [
    'POST',
    /^\/attachments$/,
    () => ok({ id: `att-${Date.now()}`, sha256: 'e3b0c44298fc1c149afbf4c8996fb924', uploadedAt: helpers.now() }),
  ],
  [
    'GET',
    /^\/attachments\/([^/]+)\/url$/,
    ({ params }) =>
      ok({ url: `https://storage.local/signed/${params[0]}`, expiresAt: new Date(Date.now() + 900_000).toISOString() }),
  ],

  /* ------------------------------------------------------------- C2 ----- */
  [
    'GET',
    /^\/vendors\/leads$/,
    () => ok(db.leads),
  ],
  [
    'POST',
    /^\/vendors\/leads$/,
    ({ body }) => {
      const lead = { id: `l-${db.leads.length + 1}`, code: nextNumber('LEAD'), stage: 'NEW', ...body };
      db.leads.unshift(lead);
      return ok(lead);
    },
  ],
  [
    'PATCH',
    /^\/vendors\/leads\/([^/]+)$/,
    ({ params, body }) => {
      const lead = db.leads.find((l) => l.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Lead not found');
      Object.assign(lead, body);
      return ok(lead);
    },
  ],
  [
    'GET',
    /^\/vendors\/market-gap$/,
    ({ role }) =>
      ok(
        scopeBranch(db.marketGap, role).map((g) => ({
          ...g,
          gap: Math.max(0, g.target - g.onPanel),
          progressPct: g.target ? Math.round((g.converted / g.target) * 100) : 0,
        })),
      ),
  ],
  [
    'PATCH',
    /^\/vendors\/market-gap\/([^/]+)$/,
    ({ params, body }) => {
      const row = db.marketGap.find((g) => g.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Row not found');
      Object.assign(row, body);
      return ok(row);
    },
  ],
  ['GET', /^\/vendors\/issues$/, ({ query }) => {
    const s = query.get('status');
    return ok(s ? db.issues.filter((i) => i.status === s) : db.issues);
  }],
  [
    'POST',
    /^\/vendors\/issues$/,
    ({ body }) => {
      const issue = {
        id: `is-${db.issues.length + 1}`,
        code: nextNumber('ISSUE'),
        status: 'OPEN',
        raisedAt: helpers.now(),
        ...body,
      };
      db.issues.unshift(issue);
      return ok(issue);
    },
  ],
  [
    'PATCH',
    /^\/vendors\/issues\/([^/]+)$/,
    ({ params, body }) => {
      const issue = db.issues.find((i) => i.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Issue not found');
      Object.assign(issue, body);
      return ok(issue);
    },
  ],
  [
    'GET',
    /^\/vendors$/,
    ({ query }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      const st = query.get('status');
      return ok(
        db.vendors
          .filter((v) => !st || v.status === st)
          .filter((v) => !q || v.legalName.toLowerCase().includes(q) || v.code.toLowerCase().includes(q))
          .map((v) => ({
            id: v.id,
            code: v.code,
            legalName: v.legalName,
            partyType: v.partyType,
            baseCity: v.baseCity,
            branchName: v.branchName,
            phone: v.phone,
            status: v.status,
            advancePct: v.advancePct,
            fleetCount: v.fleetCount,
            rating: v.rating,
            trips: v.business.trips,
            marginPaise: v.business.marginPaise,
          })),
      );
    },
  ],
  [
    'POST',
    /^\/vendors$/,
    ({ body }) => {
      const vendor = {
        id: `v-${db.vendors.length + 1}`,
        code: nextNumber('VENDOR'),
        status: 'DRAFT',
        kyc: [],
        documents: [],
        advanceHistory: [],
        fleet: [],
        business: { trips: 0, revenuePaise: 0, marginPaise: 0, advanceOutstandingPaise: 0, balancePendingPaise: 0, penaltiesAccruedPaise: 0, topLanes: [] },
        branchName: BRANCHES.find((b) => b.id === body.branchId)?.name ?? 'Nashik',
        ...body,
      };
      db.vendors.unshift(vendor);
      return ok(vendor);
    },
  ],
  ['GET', /^\/vendors\/([^/]+)$/, ({ params }) => ok(findVendor(params[0]))],
  [
    'PATCH',
    /^\/vendors\/([^/]+)$/,
    ({ params, body }) => {
      const vendor = findVendor(params[0]);
      Object.assign(vendor, body);
      return ok(vendor);
    },
  ],
  [
    'POST',
    /^\/vendors\/([^/]+)\/kyc\/([^/]+)\/verify$/,
    ({ params, role }) => {
      const vendor = findVendor(params[0]);
      const item = vendor.kyc.find((k: any) => k.kind === params[1]) ?? fail(404, 'NOT_FOUND', 'KYC item not found');
      item.status = 'VERIFIED';
      item.verifiedBy = USERS[role].name;
      item.verifiedAt = helpers.now();
      return ok(vendor);
    },
  ],
  [
    'POST',
    /^\/vendors\/([^/]+)\/kyc\/([^/]+)$/,
    ({ params, body }) => {
      const vendor = findVendor(params[0]);
      const existing = vendor.kyc.find((k: any) => k.kind === params[1]);
      const item = { kind: params[1], status: 'PENDING', verifiedBy: null, verifiedAt: null, ...body };
      if (existing) Object.assign(existing, item);
      else vendor.kyc.push(item);
      return ok(vendor);
    },
  ],
  [
    'POST',
    /^\/vendors\/([^/]+)\/documents\/([^/]+)$/,
    ({ params, body }) => {
      const vendor = findVendor(params[0]);
      const existing = vendor.documents.find((d: any) => d.kind === params[1]);
      const doc = { kind: params[1], status: 'PENDING', ...body };
      if (existing) Object.assign(existing, doc);
      else vendor.documents.push(doc);
      return ok(vendor);
    },
  ],
  [
    'POST',
    /^\/vendors\/([^/]+)\/submit$/,
    ({ params }) => {
      const vendor = findVendor(params[0]);
      const missing: any[] = [];
      if (!vendor.documents.some((d: any) => d.kind === 'TDS_DECLARATION' && d.status !== 'MISSING'))
        missing.push({ key: 'TDS_DECLARATION', label: 'TDS declaration not on file', state: 'MISSING' });
      if (vendor.partyType === 'OWNER' && !vendor.documents.some((d: any) => d.kind === 'RC'))
        missing.push({ key: 'RC', label: 'Registration certificate mandatory for an Owner', state: 'MISSING' });
      if (missing.length) fail(409, 'VENDOR_INCOMPLETE', 'The vendor file is incomplete.', { unmet: missing });
      vendor.status = 'PENDING_VERIFICATION';
      return ok(vendor);
    },
  ],
  [
    'POST',
    /^\/vendors\/([^/]+)\/activate$/,
    ({ params, role }) => {
      const vendor = findVendor(params[0]);
      const unmet = [
        ...vendor.kyc
          .filter((k: any) => k.status !== 'VERIFIED')
          .map((k: any) => ({ key: k.kind, label: `${k.kind} not verified`, state: 'UNVERIFIED' })),
        ...vendor.documents
          .filter((d: any) => d.status !== 'VERIFIED')
          .map((d: any) => ({
            key: d.kind,
            label: `${DOC_LABEL[d.kind] ?? d.kind} ${d.status === 'MISSING' ? 'not on file' : d.status.toLowerCase()}`,
            state: d.status === 'MISSING' ? 'MISSING' : 'UNVERIFIED',
          })),
      ];
      if (unmet.length)
        fail(409, 'VENDOR_INCOMPLETE', 'An incomplete file cannot be activated (BR-01).', { unmet });
      vendor.status = 'ACTIVE';
      vendor.verifiedBy = USERS[role].name;
      return ok(vendor);
    },
  ],
  [
    'PATCH',
    /^\/vendors\/([^/]+)\/advance-policy$/,
    ({ params, body, role }) => {
      const vendor = findVendor(params[0]);
      if (!body?.reason || body.reason.trim().length < 20)
        fail(400, 'REASON_TOO_SHORT', 'A reason of at least 20 characters is required.');
      return raiseApproval({
        kind: 'ADVANCE_POLICY_CHANGE',
        entityType: 'vendor',
        entityId: vendor.code,
        title: `${vendor.legalName} · advance policy ${vendor.advancePct}% → ${body.advancePct}%`,
        detail: body.reason,
        amountPaise: null,
        approverRole: 'LEADERSHIP',
        requiredPermission: 'approve.exception',
        reason: body.reason,
        role,
      });
    },
  ],
  [
    'GET',
    /^\/compliance\/queues$/,
    () =>
      ok([
        {
          key: 'VENDOR_FILES',
          name: 'Vendor files',
          rows: db.vendors
            .filter((v) => v.status !== 'ACTIVE')
            .map((v) => ({
              ref: v.code,
              subject: v.legalName,
              note: `${v.kyc.filter((k: any) => k.status === 'VERIFIED').length} of ${v.kyc.length} identity checks verified · ${
                v.documents.filter((d: any) => d.status === 'VERIFIED').length
              } of ${v.documents.length} documents verified`,
              ageDays: 4,
              flag: v.documents.every((d: any) => d.status === 'VERIFIED') ? 'Ready' : 'Blocked',
              tone: v.documents.every((d: any) => d.status === 'VERIFIED') ? 'mint' : 'flag',
              href: `/vendors/${v.id}`,
              action: 'Open file',
            })),
        },
        {
          key: 'CLIENT_CONTRACTS',
          name: 'Client contracts',
          rows: db.clients
            .filter((c) => c.engagement === 'CONTRACT')
            .map((c) => ({
              ref: c.code,
              subject: `${c.name} · rate contract ${c.agreementNo ?? ''}`.trim(),
              note: (db.rateCards[c.id] ?? []).length
                ? `${(db.rateCards[c.id] ?? []).length} lanes priced`
                : 'No rate card lanes exist for this contract',
              ageDays: 1,
              flag: (db.rateCards[c.id] ?? []).length ? 'Yours to approve' : 'No lanes priced',
              tone: (db.rateCards[c.id] ?? []).length ? 'blue' : 'flag',
              href: `/clients/${c.id}`,
              action: 'Decide',
            })),
        },
        {
          key: 'TRIP_DOCUMENTS',
          name: 'Trip documents awaiting verification',
          rows: db.trips
            .filter((t) => t.documents.some((d: any) => d.status === 'PENDING'))
            .map((t) => ({
              ref: t.code,
              subject: t.lane,
              note: `${t.documents.filter((d: any) => d.status === 'PENDING').length} document(s) uploaded and waiting · blocking the advance`,
              ageDays: 1,
              flag: 'Blocking money',
              tone: 'red',
              href: `/trips/${t.id}/documents`,
              action: 'Verify',
            })),
        },
      ]),
  ],

  /* ------------------------------------------------------------- C3 ----- */
  [
    'GET',
    /^\/clients\/([^/]+)\/rate-card$/,
    ({ params }) => ok(db.rateCards[params[0]] ?? []),
  ],
  ['GET', /^\/clients$/, ({ query }) => {
    const q = (query.get('q') ?? '').toLowerCase();
    return ok(db.clients.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)));
  }],
  [
    'POST',
    /^\/clients$/,
    ({ body }) => {
      const client = { id: `c-${db.clients.length + 1}`, code: nextNumber('CLIENT'), status: 'ACTIVE', outstandingPaise: 0, ...body };
      db.clients.unshift(client);
      return ok(client);
    },
  ],
  [
    'GET',
    /^\/clients\/([^/]+)$/,
    ({ params }) => ok(db.clients.find((c) => c.id === params[0] || c.code === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found')),
  ],
  [
    'PATCH',
    /^\/clients\/([^/]+)$/,
    ({ params, body }) => {
      const client = db.clients.find((c) => c.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found');
      Object.assign(client, body);
      return ok(client);
    },
  ],
  [
    'GET',
    /^\/indents$/,
    ({ query, role }) => {
      const stage = query.get('stage');
      const client = query.get('client');
      return ok(
        scopeBranch(db.indents, role)
          .filter((i) => !stage || i.stage === stage)
          .filter((i) => !client || i.clientId === client)
          .map((i) => ({
            id: i.id,
            code: i.code,
            clientName: i.clientName,
            lane: `${i.fromCity} → ${i.toCity}`,
            material: i.material,
            weightTn: i.weightTn,
            truckType: i.truckType,
            pickupDate: i.pickupDate,
            sellRatePaise: i.sellRatePaise,
            buyRatePaise: i.buyRatePaise,
            quoteCount: i.quotes.length,
            stage: i.stage,
            branchName: i.branchName,
            failureCause: i.failureCause,
          })),
      );
    },
  ],
  [
    'POST',
    /^\/indents$/,
    ({ body }) => {
      if (body.rateSource === 'SPOT' && !body.spotConfirmationAttachmentId)
        fail(400, 'SPOT_CONFIRMATION_REQUIRED', 'A spot indent needs the client’s written rate confirmation (BR-26).');
      if (body.rateSource === 'SPOT' && body.sellRatePaise <= body.sourcingRatePaise)
        fail(400, 'SPOT_BELOW_SOURCING', 'A spot freight must exceed the sourcing rate (BR-38).');
      const indent = {
        id: `i-${db.indents.length + 1}`,
        code: nextNumber('INDENT'),
        stage: 'OPEN',
        bandLocked: true,
        buyRatePaise: null,
        vendorId: null,
        awardedQuoteId: null,
        quotes: [],
        failureCause: null,
        branchName: BRANCHES.find((b) => b.id === body.branchId)?.name ?? 'Nashik',
        clientName: db.clients.find((c) => c.id === body.clientId)?.name ?? '—',
        distanceKm: 0,
        ...body,
      };
      db.indents.unshift(indent);
      return ok(indent);
    },
  ],
  ['GET', /^\/indents\/([^/]+)$/, ({ params }) => ok(findIndent(params[0]))],
  [
    'POST',
    /^\/indents\/([^/]+)\/award$/,
    ({ params, body, role }) => {
      const indent = findIndent(params[0]);
      const quote = indent.quotes.find((q: any) => q.id === body.quoteId) ?? fail(404, 'NOT_FOUND', 'Quote not found');
      const vendor = db.vendors.find((v) => v.id === quote.vendorId);
      if (vendor && vendor.status !== 'ACTIVE')
        fail(409, 'VENDOR_NOT_ACTIVE', `${vendor.legalName} is ${vendor.status} and cannot be awarded work (BR-01).`, {
          unmet: [{ key: 'VENDOR', label: `${vendor.legalName} is not an active vendor`, state: 'BLOCKED' }],
        });
      if (quote.bandPosition === 'ABOVE_BAND')
        return raiseApproval({
          kind: 'ABOVE_BAND_PRICE',
          entityType: 'indent',
          entityId: indent.code,
          title: `Award at ₹${(quote.amountPaise / 100).toLocaleString('en-IN')} · band ceiling ₹${(
            indent.bidMaxPaise / 100
          ).toLocaleString('en-IN')}`,
          detail: `${indent.fromCity} → ${indent.toCity}. Awarding ${quote.vendorName} above the published band.`,
          amountPaise: quote.amountPaise,
          approverRole: 'LEADERSHIP',
          requiredPermission: 'approve.above_band',
          reason: body.reason ?? 'Above-band award requested from the indent screen.',
          role,
        });
      indent.buyRatePaise = quote.amountPaise;
      indent.vendorId = quote.vendorId;
      indent.awardedQuoteId = quote.id;
      indent.stage = 'VENDOR_ASSIGNED';
      indent.advancePct = vendor?.advancePct ?? indent.advancePct;
      quote.status = 'ACCEPTED';
      indent.quotes.filter((q: any) => q.id !== quote.id).forEach((q: any) => (q.status = 'REJECTED'));
      return ok(indent);
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/placement$/,
    ({ params, body }) => {
      const indent = findIndent(params[0]);
      Object.assign(indent, {
        vehicleNo: body.vehicleNo,
        driverName: body.driverName,
        driverLicence: body.driverLicence,
        reportedAt: body.reportedAt,
        stage: 'VEHICLE_PLACED',
        transitDelay: !!body.transitDelay,
        placementRemarks: body.remarks ?? null,
      });
      return ok(indent);
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/trip$/,
    ({ params }) => {
      const indent = findIndent(params[0]);
      if (indent.stage !== 'VEHICLE_PLACED')
        fail(409, 'NOT_PLACED', 'A trip can only be created once the vehicle is placed.');
      const code = nextNumber('TRIP');
      const trip = {
        id: `t-${code}`,
        code,
        indentId: indent.id,
        indentCode: indent.code,
        lrCode: null,
        clientId: indent.clientId,
        clientName: indent.clientName,
        vendorId: indent.vendorId,
        vendorName: db.vendors.find((v) => v.id === indent.vendorId)?.legalName ?? '—',
        branchId: indent.branchId,
        branchName: indent.branchName,
        vehicleNo: indent.vehicleNo,
        vehicleType: indent.truckType,
        capacityTn: indent.weightTn,
        driverName: indent.driverName,
        driverLicence: indent.driverLicence,
        driverPhone: null,
        lane: `${indent.fromCity} → ${indent.toCity}`,
        distanceKm: indent.distanceKm,
        weightTn: indent.weightTn,
        transitDaysRequired: indent.transitDays,
        actualTransitDays: null,
        transitDelay: false,
        remarks: indent.remarks,
        buyRatePaise: indent.buyRatePaise,
        sellRatePaise: indent.sellRatePaise,
        advancePct: indent.advancePct,
        ewayNo: null,
        ewayValidTill: null,
        stage: 'OPEN',
        deliveredAt: null,
        podStatus: 'PENDING',
        podReceivedAt: null,
        podPenaltyPaise: 0,
        podClosureBasis: null,
        advancePaidPaise: 0,
        balancePaidPaise: 0,
        billed: false,
        documents: [],
        charges: [],
        lr: null,
      };
      db.trips.unshift(trip);
      indent.stage = 'TRIP_CREATED';
      return ok(trip);
    },
  ],
  [
    'PATCH',
    /^\/indents\/([^/]+)\/advance-pct$/,
    ({ params, body, role }) => {
      const indent = findIndent(params[0]);
      if (!body?.reason || body.reason.trim().length < 20)
        fail(400, 'REASON_TOO_SHORT', 'A reason of at least 20 characters is required.');
      return raiseApproval({
        kind: 'ADVANCE_POLICY_CHANGE',
        entityType: 'indent',
        entityId: indent.code,
        title: `${indent.code} · advance ${indent.advancePct}% → ${body.advancePct}%`,
        detail: body.reason,
        amountPaise: null,
        approverRole: 'LEADERSHIP',
        requiredPermission: 'approve.exception',
        reason: body.reason,
        role,
      });
    },
  ],

  /* ------------------------------------------------------------- C4 ----- */
  [
    'GET',
    /^\/trips$/,
    ({ query, role }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      const stage = query.get('stage');
      const podStatus = query.get('pod_status');
      return ok(
        scopeBranch(db.trips, role)
          .filter((t) => !stage || t.stage === stage)
          .filter((t) => !podStatus || t.podStatus === podStatus)
          .filter(
            (t) =>
              !q ||
              [t.code, t.lrCode, t.indentCode, t.vehicleNo, t.vendorName, t.clientName, t.branchName]
                .filter(Boolean)
                .some((v: string) => v.toLowerCase().includes(q)),
          )
          .map(tripSummary),
      );
    },
  ],
  ['GET', /^\/trips\/([^/]+)\/documents$/, ({ params }) => ok(findTrip(params[0]).documents)],
  [
    'POST',
    /^\/trips\/([^/]+)\/documents\/([^/]+)\/verify$/,
    ({ params, role }) => {
      const trip = findTrip(params[0]);
      const doc = trip.documents.find((d: any) => d.kind === params[1]) ?? fail(404, 'NOT_FOUND', 'Document not found');
      if (doc.status === 'MISSING') fail(409, 'NOT_UPLOADED', 'Nothing has been uploaded to verify.');
      doc.status = 'VERIFIED';
      doc.verifiedBy = USERS[role].name;
      doc.verifiedAt = helpers.now();
      doc.rejectReason = null;
      return ok(doc);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/documents\/([^/]+)\/reject$/,
    ({ params, body }) => {
      if (!body?.reason?.trim()) fail(400, 'REASON_REQUIRED', 'A reason is required to reject a document.');
      const trip = findTrip(params[0]);
      const doc = trip.documents.find((d: any) => d.kind === params[1]) ?? fail(404, 'NOT_FOUND', 'Document not found');
      doc.status = 'REJECTED';
      doc.rejectReason = body.reason;
      return ok(doc);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/documents\/([^/]+)$/,
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      let doc = trip.documents.find((d: any) => d.kind === params[1]);
      if (!doc) {
        doc = {
          kind: params[1],
          label: DOC_LABEL[params[1]] ?? params[1],
          group: 'CLIENT',
          gatesAdvance: ADVANCE_DOCUMENT_SET.includes(params[1]),
          keyedValues: {},
        };
        trip.documents.push(doc);
      }
      Object.assign(doc, {
        status: 'PENDING',
        attachmentId: body?.attachmentId ?? `att-${params[1].toLowerCase()}`,
        uploadedAt: helpers.now(),
        rejectReason: null,
        keyedValues: { ...(doc.keyedValues ?? {}), ...(body?.keyedValues ?? {}) },
      });
      return ok(doc);
    },
  ],
  [
    'GET',
    /^\/trips\/([^/]+)\/cross-check$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      const eway = trip.documents.find((d: any) => d.kind === 'EWAY_BILL');
      const invoice = trip.documents.find((d: any) => d.kind === 'CLIENT_INVOICE_OR_PO');
      const runnable = eway?.status !== 'MISSING' && invoice?.status !== 'MISSING' && !!trip.lr;
      if (!runnable)
        return ok({
          runnable: false,
          waitingOn: ['Client invoice', 'E-way bill', 'Lorry receipt'].filter((_, i) =>
            [invoice?.status === 'MISSING', eway?.status === 'MISSING', !trip.lr][i],
          ),
          mismatches: [],
          overridden: !!trip.crossCheckOverride,
        });
      const mismatches: any[] = [];
      const ewayVehicle = eway?.keyedValues?.vehicleNo ?? '';
      if (ewayVehicle && ewayVehicle.replace(/\s/g, '') !== trip.vehicleNo.replace(/\s/g, ''))
        mismatches.push({ field: 'Vehicle number', a: { source: 'E-way bill', value: ewayVehicle }, b: { source: 'Lorry receipt', value: trip.vehicleNo } });
      const invNo = invoice?.keyedValues?.invoiceNo ?? '';
      if (invNo && trip.lr?.invoice?.number && invNo !== trip.lr.invoice.number)
        mismatches.push({ field: 'Invoice number', a: { source: 'Client invoice', value: invNo }, b: { source: 'Lorry receipt', value: trip.lr.invoice.number } });
      return ok({ runnable: true, waitingOn: [], mismatches, overridden: !!trip.crossCheckOverride });
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/cross-check\/override$/,
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      if (!body?.reason || body.reason.trim().length < 20)
        fail(400, 'REASON_TOO_SHORT', 'An override reason of at least 20 characters is required (BR-44).');
      return raiseApproval({
        kind: 'DOC_OVERRIDE',
        entityType: 'trip',
        entityId: trip.code,
        title: `Cross-check override · ${trip.code}`,
        detail: body.reason,
        amountPaise: null,
        approverRole: 'COMPLIANCE',
        requiredPermission: 'approve.exception',
        reason: body.reason,
        role,
      });
    },
  ],
  ['GET', /^\/trips\/([^/]+)\/charges$/, ({ params }) => ok(findTrip(params[0]).charges)],
  [
    'POST',
    /^\/trips\/([^/]+)\/charges$/,
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      const charge = {
        id: `ch-${Date.now()}`,
        capturedBy: USERS[role].name,
        capturedAt: helpers.now(),
        ...body,
      };
      trip.charges.push(charge);
      return ok(charge);
    },
  ],
  ['GET', /^\/trips\/([^/]+)\/lr$/, ({ params }) => ok(findTrip(params[0]).lr)],
  [
    'PATCH',
    /^\/trips\/([^/]+)\/lr$/,
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      trip.lr = { ...(trip.lr ?? { status: 'DRAFT', code: null }), ...body };
      return ok(trip.lr);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/lr\/generate$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      if (!trip.vehicleNo) fail(409, 'NOT_PLACED', 'A lorry receipt cannot be issued before the truck is placed (BR-13).');
      if (trip.lrCode) fail(409, 'LR_EXISTS', 'This trip already carries a lorry receipt (BR-22).');
      trip.lrCode = nextNumber('LR');
      trip.lr = { ...(trip.lr ?? {}), code: trip.lrCode, status: 'BOOKED', lrDate: helpers.now(), bookedAt: helpers.now() };
      return ok(trip.lr);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/lr\/share$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      trip.lr = { ...(trip.lr ?? {}), sharedAt: helpers.now() };
      return ok(trip.lr);
    },
  ],
  ['GET', /^\/trips\/([^/]+)$/, ({ params }) => ok(findTrip(params[0]))],

  /* ------------------------------------------------------------- C5 ----- */
  [
    'GET',
    /^\/pod\/receiving$/,
    ({ role }) => {
      const rows = scopeBranch(db.trips, role).filter((t) => t.deliveredAt);
      return ok({
        stats: {
          attachedInTransit: rows.filter((t) => t.podStatus === 'ATTACHED').length,
          receivedToday: db.podReceipts.length,
          awaitingVerification: rows.filter((t) => t.podStatus === 'RECEIVED').length,
          awaitingApproval: rows.filter((t) => t.podStatus === 'VERIFIED').length,
          balanceHeldPaise: rows
            .filter((t) => !['APPROVED', 'WAIVED'].includes(t.podStatus))
            .reduce((a, t) => a + (t.buyRatePaise - t.advancePaidPaise), 0),
          pastTwentyDays: rows.filter(
            (t) => Math.floor((Date.now() - new Date(t.deliveredAt).getTime()) / 86_400_000) > db.config.pod_tat_days,
          ).length,
        },
        rows: rows.map((t) => ({
          tripId: t.id,
          tripCode: t.code,
          lrCode: t.lrCode,
          vendorName: t.vendorName,
          lane: t.lane,
          deliveredAt: t.deliveredAt,
          courierDocket: t.podCourierDocket ?? null,
          attachedAt: t.podStatus === 'PENDING' ? null : t.deliveredAt,
          ageDays: Math.floor((Date.now() - new Date(t.deliveredAt).getTime()) / 86_400_000),
          podStatus: t.podStatus,
          balanceHeldPaise: t.buyRatePaise - t.advancePaidPaise,
        })),
      });
    },
  ],
  [
    'GET',
    /^\/pod\/pending$/,
    ({ role, query }) => {
      const branch = (query.get('branch') ?? '').trim().toLowerCase();
      const transporter = (query.get('transporter') ?? '').trim().toLowerCase();
      const ageing = query.get('ageing');
      const rows = scopeBranch(db.trips, role)
        .filter((t) => t.deliveredAt && !['APPROVED', 'WAIVED'].includes(t.podStatus))
        .filter((t) => !branch || t.branchName.toLowerCase().includes(branch))
        .filter((t) => !transporter || t.vendorName.toLowerCase().includes(transporter))
        .map((t) => {
          const ageDays = Math.floor((Date.now() - new Date(t.deliveredAt).getTime()) / 86_400_000);
          return {
            tripId: t.id,
            tripCode: t.code,
            lrCode: t.lrCode,
            vendorName: t.vendorName,
            clientName: t.clientName,
            lane: t.lane,
            branchName: t.branchName,
            deliveredAt: t.deliveredAt,
            ageDays,
            daysLeft: db.config.pod_tat_days - ageDays,
            podStatus: t.podStatus,
            penaltyPaise: Math.max(0, ageDays - db.config.pod_tat_days) * db.config.pod_penalty_per_day_paise,
            balanceHeldPaise: t.buyRatePaise - t.advancePaidPaise,
            forfeited: ageDays > db.config.pod_forfeit_days,
          };
        })
        .filter((r) => {
          if (!ageing) return true;
          if (ageing === 'within') return r.daysLeft >= 0;
          if (ageing === 'breached') return r.daysLeft < 0 && !r.forfeited;
          if (ageing === 'forfeited') return r.forfeited;
          return true;
        })
        .sort((a, b) => b.ageDays - a.ageDays);
      return ok({
        stats: {
          pending: rows.length,
          breached: rows.filter((r) => r.ageDays > db.config.pod_tat_days).length,
          penaltyAccruedPaise: rows.reduce((a, r) => a + r.penaltyPaise, 0),
          balanceHeldPaise: rows.reduce((a, r) => a + r.balanceHeldPaise, 0),
        },
        rows,
      });
    },
  ],
  [
    'GET',
    /^\/pod\/([^/]+)$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      const ageDays = trip.deliveredAt
        ? Math.floor((Date.now() - new Date(trip.deliveredAt).getTime()) / 86_400_000)
        : 0;
      return ok({
        tripId: trip.id,
        tripCode: trip.code,
        lrCode: trip.lrCode,
        vendorName: trip.vendorName,
        clientName: trip.clientName,
        lane: trip.lane,
        deliveredAt: trip.deliveredAt,
        podStatus: trip.podStatus,
        podReceivedAt: trip.podReceivedAt,
        ageDays,
        penaltyPaise: Math.max(0, ageDays - db.config.pod_tat_days) * db.config.pod_penalty_per_day_paise,
        receipt: db.podReceipts.find((r) => r.tripId === trip.id) ?? null,
        pages: trip.podPages ?? 2,
        attachmentIds: ['att-pod-1', 'att-pod-2'],
        verifiedBy: trip.podVerifiedBy ?? null,
        approvedBy: trip.podApprovedBy ?? null,
        charges: trip.charges,
      });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/receive$/,
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      if (!body?.courierDocket) fail(400, 'DOCKET_REQUIRED', 'The courier docket is required.');
      const receipt = {
        id: `pdr-${Date.now()}`,
        code: nextNumber('POD_RECEIPT'),
        tripId: trip.id,
        courierDocket: body.courierDocket,
        sentOn: body.sentOn ?? null,
        receivedOn: body.receivedOn,
        pages: body.pages,
        receivedBy: body.receivedBy ?? USERS[role].name,
        condition: body.condition ?? null,
      };
      db.podReceipts.unshift(receipt);
      trip.podStatus = 'RECEIVED';
      trip.podReceivedAt = body.receivedOn;
      trip.podCourierDocket = body.courierDocket;
      return ok(receipt);
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/verify$/,
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      if (trip.podStatus !== 'RECEIVED')
        fail(409, 'NOT_RECEIVED', 'The physical copy must be logged in the receiving register first (BR-49).');
      const failedChecks = Object.entries(body?.checklist ?? {}).filter(([, v]) => v === false);
      if (failedChecks.length && !body?.remarks?.trim())
        fail(400, 'REMARKS_REQUIRED', 'Remarks are mandatory when any check fails.');
      (body?.charges ?? []).forEach((c: any) =>
        trip.charges.push({ id: `ch-${Date.now()}-${c.chargeType}`, capturedBy: USERS[role].name, capturedAt: helpers.now(), ...c }),
      );
      trip.podStatus = 'VERIFIED';
      trip.podVerifiedBy = USERS[role].userId;
      trip.podVerifiedByName = USERS[role].name;
      return ok({ tripId: trip.id, podStatus: trip.podStatus, verifiedBy: USERS[role].name });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/reject$/,
    ({ params, body }) => {
      if (!body?.reason?.trim()) fail(400, 'REASON_REQUIRED', 'A reason is required.');
      const trip = findTrip(params[0]);
      trip.podStatus = 'ATTACHED';
      trip.podReceivedAt = null; // BR-52 — the clock resumes over the stopped period
      trip.podRejectReason = body.reason;
      return ok({ tripId: trip.id, podStatus: trip.podStatus });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/approve$/,
    ({ params, role }) => {
      const trip = findTrip(params[0]);
      if (trip.podStatus !== 'VERIFIED') fail(409, 'NOT_VERIFIED', 'The POD must be verified before it is approved.');
      if (trip.podVerifiedBy === USERS[role].userId)
        fail(409, 'APPROVER_IS_VERIFIER', 'The person who verified a POD may not approve it (BR-50).');
      trip.podStatus = 'APPROVED';
      trip.podApprovedBy = USERS[role].userId;
      trip.podApprovedByName = USERS[role].name;
      return ok({ tripId: trip.id, podStatus: trip.podStatus, approvedBy: USERS[role].name });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/waive$/,
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      if (!body?.reason || body.reason.trim().length < 30)
        fail(400, 'REASON_TOO_SHORT', 'A waiver reason of at least 30 characters is required (BR-43).');
      return raiseApproval({
        kind: 'PENALTY_WAIVER',
        entityType: 'trip',
        entityId: trip.code,
        title: `Waive POD penalty · ${trip.code}`,
        detail: body.reason,
        amountPaise: trip.podPenaltyPaise,
        approverRole: 'LEADERSHIP',
        requiredPermission: 'approve.waiver',
        reason: body.reason,
        role,
      });
    },
  ],

  /* ------------------------------------------------------------- C6 ----- */
  [
    'GET',
    /^\/payments\/advance$/,
    ({ role }) =>
      ok(
        scopeBranch(db.trips, role)
          .filter((t) => t.advancePaidPaise === 0 && t.buyRatePaise)
          .map((t) => {
            const gate = advanceGate(t);
            return {
              indentId: t.indentId,
              indentCode: t.indentCode,
              tripId: t.id,
              tripCode: t.code,
              vendorName: t.vendorName,
              lane: t.lane,
              branchName: t.branchName,
              advancePct: t.advancePct ?? 40,
              grossPaise: gate.grossPaise,
              blocked: gate.unmet.length > 0,
              unmetCount: gate.unmet.length,
            };
          }),
      ),
  ],
  [
    'GET',
    /^\/payments\/advance\/([^/]+)$/,
    ({ params }) => {
      const trip =
        db.trips.find((t) => t.indentId === params[0] || t.indentCode === params[0] || t.id === params[0]) ??
        fail(404, 'NOT_FOUND', 'No trip for this indent');
      const gate = advanceGate(trip);
      return ok({
        tripId: trip.id,
        tripCode: trip.code,
        indentCode: trip.indentCode,
        vendorName: trip.vendorName,
        beneficiary: { accountHolder: trip.vendorName, account: '••4471', ifsc: 'HDFC0000188' },
        advancePct: trip.advancePct ?? 40,
        buyRatePaise: trip.buyRatePaise,
        grossPaise: gate.grossPaise,
        tdsPaise: 0,
        netPaise: gate.netPaise,
        unmet: gate.unmet,
        cleared: gate.cleared,
        releasable: gate.unmet.length === 0 && trip.advancePaidPaise === 0,
        alreadyReleased: trip.advancePaidPaise > 0,
      });
    },
  ],
  [
    'POST',
    /^\/payments\/advance\/([^/]+)$/,
    ({ params, body, headers, role }) => {
      const trip =
        db.trips.find((t) => t.indentId === params[0] || t.indentCode === params[0] || t.id === params[0]) ??
        fail(404, 'NOT_FOUND', 'No trip for this indent');
      const key = headers['idempotency-key'] ?? headers['Idempotency-Key'];
      const existing = db.payments.find((p) => p.idempotencyKey === key);
      if (existing) return ok(existing);
      const gate = advanceGate(trip);
      if (gate.unmet.length)
        fail(409, 'ADVANCE_BLOCKED', 'The advance is blocked by unverified documents (BR-07, BR-58).', {
          unmet: gate.unmet,
        });
      for (const field of ['mode', 'transferType', 'remittingAccount', 'utr', 'valueDate'])
        if (!body?.[field]) fail(400, 'PAYMENT_FIELD_REQUIRED', `${field} is required on every payment (BR-09).`);
      const payment = {
        id: `pay-${Date.now()}`,
        tripId: trip.id,
        tripCode: trip.code,
        indentId: trip.indentId,
        kind: 'ADVANCE',
        grossPaise: gate.grossPaise,
        penaltyPaise: 0,
        netPaise: gate.grossPaise,
        tdsPaise: 0,
        releasedBy: USERS[role].name,
        releasedAt: helpers.now(),
        idempotencyKey: key,
        ...body,
      };
      db.payments.unshift(payment);
      trip.advancePaidPaise = gate.grossPaise;
      return ok(payment);
    },
  ],
  [
    'GET',
    /^\/payments\/balance$/,
    ({ role }) =>
      ok(
        scopeBranch(db.trips, role)
          .filter((t) => t.deliveredAt && t.balancePaidPaise === 0)
          .map((t) => {
            const gate = balanceGate(t);
            return {
              tripId: t.id,
              tripCode: t.code,
              vendorName: t.vendorName,
              lane: t.lane,
              branchName: t.branchName,
              podStatus: t.podStatus,
              podAgeDays: gate.podAgeDays,
              netPaise: gate.breakdown.netPaise,
              penaltyPaise: gate.breakdown.penaltyPaise,
              blocked: gate.unmet.length > 0,
              unmetCount: gate.unmet.length,
            };
          }),
      ),
  ],
  [
    'GET',
    /^\/payments\/balance\/([^/]+)$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      const gate = balanceGate(trip);
      return ok({
        tripId: trip.id,
        tripCode: trip.code,
        vendorName: trip.vendorName,
        lane: trip.lane,
        beneficiary: { accountHolder: trip.vendorName, account: '••4471', ifsc: 'HDFC0000188' },
        podStatus: trip.podStatus,
        podAgeDays: gate.podAgeDays,
        breakdown: gate.breakdown,
        unmet: gate.unmet,
        releasable: gate.unmet.length === 0 && trip.balancePaidPaise === 0,
        alreadyReleased: trip.balancePaidPaise > 0,
      });
    },
  ],
  [
    'POST',
    /^\/payments\/balance\/([^/]+)$/,
    ({ params, body, headers, role }) => {
      const trip = findTrip(params[0]);
      const key = headers['idempotency-key'] ?? headers['Idempotency-Key'];
      const existing = db.payments.find((p) => p.idempotencyKey === key);
      if (existing) return ok(existing);
      const gate = balanceGate(trip);
      if (gate.podAgeDays > db.config.pod_forfeit_days)
        fail(409, 'POD_FORFEITED', `The POD is past ${db.config.pod_forfeit_days} days. Nothing is payable (BR-25).`, {
          unmet: gate.unmet,
        });
      if (gate.unmet.length)
        fail(409, 'BALANCE_BLOCKED', 'The balance is blocked (BR-10).', { unmet: gate.unmet });
      for (const field of ['mode', 'transferType', 'remittingAccount', 'utr', 'valueDate'])
        if (!body?.[field]) fail(400, 'PAYMENT_FIELD_REQUIRED', `${field} is required on every payment (BR-09).`);
      const payment = {
        id: `pay-${Date.now()}`,
        tripId: trip.id,
        tripCode: trip.code,
        kind: 'BALANCE',
        grossPaise: gate.breakdown.grossPaise,
        penaltyPaise: gate.breakdown.penaltyPaise,
        netPaise: gate.breakdown.netPaise,
        tdsPaise: 0,
        releasedBy: USERS[role].name,
        releasedAt: helpers.now(),
        idempotencyKey: key,
        ...body,
      };
      db.payments.unshift(payment);
      trip.balancePaidPaise = gate.breakdown.netPaise;
      trip.stage = 'CLOSED';
      return ok(payment);
    },
  ],
  ['GET', /^\/payments\/bills$/, ({ query }) => {
    const s = query.get('status');
    return ok(s ? db.vendorBills.filter((b) => b.status === s) : db.vendorBills);
  }],
  [
    'GET',
    /^\/payments\/bills\/([^/]+)$/,
    ({ params }) => ok(db.vendorBills.find((b) => b.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Bill not found')),
  ],
  [
    'POST',
    /^\/payments\/bills\/([^/]+)\/accept$/,
    ({ params, body }) => {
      const bill = db.vendorBills.find((b) => b.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Bill not found');
      if (body?.atTheirFigure && !body?.reason?.trim())
        fail(400, 'REASON_REQUIRED', 'Accepting a transporter’s own figure needs a reason.');
      bill.status = 'ACCEPTED';
      bill.acceptedAtFigurePaise = body?.atTheirFigure ? bill.totalPaise : bill.computedBalancePaise;
      return ok(bill);
    },
  ],
  [
    'POST',
    /^\/payments\/bills\/([^/]+)\/query$/,
    ({ params, body }) => {
      const bill = db.vendorBills.find((b) => b.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Bill not found');
      if (!body?.note?.trim()) fail(400, 'NOTE_REQUIRED', 'A note is required to query a bill.');
      bill.status = 'QUERIED';
      bill.queryNote = body.note;
      return ok(bill);
    },
  ],

  /* ------------------------------------------------------------- C7 ----- */
  [
    'GET',
    /^\/invoices$/,
    ({ query }) => {
      const s = query.get('status');
      const q = (query.get('q') ?? '').toLowerCase();
      return ok(
        db.invoices
          .filter((i) => !s || i.status === s)
          .filter((i) => !q || i.code.toLowerCase().includes(q) || i.clientName.toLowerCase().includes(q)),
      );
    },
  ],
  [
    'POST',
    /^\/invoices$/,
    ({ body }) => {
      const invoice = {
        id: `inv-${db.invoices.length + 500}`,
        code: null,
        status: 'DRAFT',
        receivedPaise: 0,
        taxMechanism: 'REVERSE_CHARGE',
        cancelReason: null,
        clientName: db.clients.find((c) => c.id === body.clientId)?.name ?? '—',
        ...body,
      };
      db.invoices.unshift(invoice);
      return ok(invoice);
    },
  ],
  [
    'POST',
    /^\/invoices\/([^/]+)\/generate$/,
    ({ params }) => {
      const invoice = findInvoice(params[0]);
      if (invoice.code) fail(409, 'ALREADY_ISSUED', 'This invoice already carries a number.');
      invoice.code = nextNumber('INVOICE');
      invoice.status = 'ISSUED';
      (invoice.tripIds ?? []).forEach((id: string) => {
        const trip = db.trips.find((t) => t.id === id);
        if (trip) trip.billed = true;
      });
      return ok(invoice);
    },
  ],
  [
    'POST',
    /^\/invoices\/([^/]+)\/cancel$/,
    ({ params, body }) => {
      if (!body?.reason?.trim()) fail(400, 'REASON_REQUIRED', 'A cancellation reason is required.');
      const invoice = findInvoice(params[0]);
      invoice.status = 'CANCELLED';
      invoice.cancelReason = body.reason;
      return ok(invoice);
    },
  ],
  [
    'GET',
    /^\/invoices\/([^/]+)$/,
    ({ params }) => {
      const invoice = findInvoice(params[0]);
      return ok({
        ...invoice,
        company: db.config.company,
        client: db.clients.find((c) => c.id === invoice.clientId) ?? null,
        trips: (invoice.tripIds ?? []).map((id: string) => db.trips.find((t) => t.id === id)).filter(Boolean).map(tripSummary),
        receipts: db.receipts.filter((r) => r.invoiceId === invoice.id),
      });
    },
  ],
  [
    'POST',
    /^\/receipts$/,
    ({ body }) => {
      const invoice = findInvoice(body.invoiceId);
      const balance = invoice.totalPaise - invoice.receivedPaise;
      if (body.amountPaise > balance)
        fail(400, 'RECEIPT_EXCEEDS_BALANCE', 'A receipt cannot exceed the outstanding balance.');
      const receipt = {
        id: `r-${db.receipts.length + 1}`,
        code: nextNumber('RECEIPT'),
        invoiceCode: invoice.code,
        clientId: invoice.clientId,
        clientName: invoice.clientName,
        ...body,
      };
      db.receipts.unshift(receipt);
      invoice.receivedPaise += body.amountPaise;
      invoice.status = invoice.receivedPaise >= invoice.totalPaise ? 'PAID' : 'PART_PAID';
      return ok(receipt);
    },
  ],
  [
    'GET',
    /^\/receivables$/,
    () => {
      const open = db.invoices.filter((i) => ['ISSUED', 'PART_PAID'].includes(i.status));
      const bucketOf = (i: any) => {
        const days = Math.floor((Date.now() - new Date(i.dueDate).getTime()) / 86_400_000);
        if (days <= 0) return 'CURRENT';
        if (days <= 30) return 'D0_30';
        if (days <= 60) return 'D31_60';
        if (days <= 90) return 'D61_90';
        return 'D90_PLUS';
      };
      const rows = open.map((i) => ({
        invoiceId: i.id,
        invoiceCode: i.code,
        clientName: i.clientName,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        totalPaise: i.totalPaise,
        receivedPaise: i.receivedPaise,
        balancePaise: i.totalPaise - i.receivedPaise,
        bucket: bucketOf(i),
      }));
      const buckets = ['CURRENT', 'D0_30', 'D31_60', 'D61_90', 'D90_PLUS'].map((b) => ({
        bucket: b,
        amountPaise: rows.filter((r) => r.bucket === b).reduce((a, r) => a + r.balancePaise, 0),
        count: rows.filter((r) => r.bucket === b).length,
      }));
      return ok({ rows, buckets, receipts: db.receipts });
    },
  ],

  /* ------------------------------------------------------------- C8 ----- */
  [
    'GET',
    /^\/rfqs$/,
    ({ query }) => {
      const s = query.get('status');
      const lanes = db.rfqs.flatMap((r) => r.lanes);
      return ok({
        stats: {
          open: db.rfqs.filter((r) => !['CLOSED', 'LOST'].includes(r.status)).length,
          lanesOut: lanes.length,
          lanesWon: lanes.filter((l: any) => l.outcome === 'WON').length,
          lanesLost: lanes.filter((l: any) => l.outcome === 'LOST').length,
          valueWonPaise: lanes.filter((l: any) => l.outcome === 'WON').reduce((a: number, l: any) => a + (l.awardedRatePaise ?? 0), 0),
        },
        rows: db.rfqs
          .filter((r) => !s || r.status === s)
          .map((r) => ({
            id: r.id,
            clientName: r.clientName,
            reference: r.reference,
            cycleMonths: r.cycleMonths,
            periodFrom: r.periodFrom,
            periodTo: r.periodTo,
            dueAt: r.dueAt,
            status: r.status,
            laneCount: r.lanes.length,
          })),
      });
    },
  ],
  [
    'POST',
    /^\/rfqs$/,
    ({ body }) => {
      const rfq = {
        id: `rfq-${db.rfqs.length + 1}`,
        status: 'DRAFT',
        lanes: [],
        submittedBy: null,
        submittedAt: null,
        clientName: db.clients.find((c) => c.id === body.clientId)?.name ?? '—',
        ...body,
      };
      db.rfqs.unshift(rfq);
      return ok(rfq);
    },
  ],
  ['GET', /^\/rfqs\/([^/]+)$/, ({ params }) => ok(findRfq(params[0]))],
  [
    'POST',
    /^\/rfqs\/([^/]+)\/lanes$/,
    ({ params, body }) => {
      const rfq = findRfq(params[0]);
      const lane = {
        id: `rl-${Date.now()}`,
        sourcingMode: 'MONTHLY',
        sourcingRows: [],
        sourcingAvgPaise: 0,
        overheadPaise: 0,
        marginPaise: 0,
        quotedRatePaise: 0,
        outcome: null,
        awardedRatePaise: null,
        ...body,
      };
      rfq.lanes.push(lane);
      rfq.status = 'SOURCING';
      return ok(lane);
    },
  ],
  [
    'PATCH',
    /^\/rfqs\/([^/]+)\/lanes\/([^/]+)\/sourcing$/,
    ({ params, body }) => {
      const rfq = findRfq(params[0]);
      const lane = rfq.lanes.find((l: any) => l.id === params[1]) ?? fail(404, 'NOT_FOUND', 'Lane not found');
      lane.sourcingMode = body.sourcingMode;
      lane.sourcingRows = body.sourcingRows;
      const rates = body.sourcingRows.map((r: any) => r.ratePaise).filter((r: number) => r > 0);
      lane.sourcingAvgPaise = rates.length ? Math.round(rates.reduce((a: number, b: number) => a + b, 0) / rates.length) : 0;
      lane.quotedRatePaise = lane.sourcingAvgPaise + lane.overheadPaise + lane.marginPaise;
      return ok(lane);
    },
  ],
  [
    'PATCH',
    /^\/rfqs\/([^/]+)\/lanes\/([^/]+)\/buildup$/,
    ({ params, body }) => {
      const rfq = findRfq(params[0]);
      const lane = rfq.lanes.find((l: any) => l.id === params[1]) ?? fail(404, 'NOT_FOUND', 'Lane not found');
      lane.overheadPaise = body.overheadPaise;
      lane.marginPaise = body.marginPaise;
      lane.quotedRatePaise = lane.sourcingAvgPaise + lane.overheadPaise + lane.marginPaise;
      rfq.status = 'QUOTED';
      return ok(lane);
    },
  ],
  [
    'POST',
    /^\/rfqs\/([^/]+)\/submit$/,
    ({ params, role }) => {
      const rfq = findRfq(params[0]);
      if (role !== 'LEADERSHIP')
        fail(403, 'FORBIDDEN', 'Only LEADERSHIP may submit an RFQ (part 01 §2.4).');
      rfq.status = 'SUBMITTED';
      rfq.submittedBy = USERS[role].name;
      rfq.submittedAt = helpers.now();
      return ok(rfq);
    },
  ],
  [
    'POST',
    /^\/rfqs\/([^/]+)\/award$/,
    ({ params, body }) => {
      const rfq = findRfq(params[0]);
      const created: any[] = [];
      (body?.lanes ?? []).forEach((decision: any) => {
        const lane = rfq.lanes.find((l: any) => l.id === decision.laneId);
        if (!lane) return;
        lane.outcome = decision.outcome;
        lane.awardedRatePaise = decision.awardedRatePaise ?? null;
        if (decision.outcome === 'WON') {
          const row = {
            id: `rc-${Date.now()}-${lane.id}`,
            rfqLaneId: lane.id,
            origin: lane.origin,
            destination: lane.destination,
            truckType: lane.truckType,
            ratePaise: decision.awardedRatePaise ?? lane.quotedRatePaise,
            transitDays: lane.transitDays,
            reportingRule: lane.reportingRule,
            validFrom: rfq.periodFrom,
            validTo: rfq.periodTo,
          };
          db.rateCards[rfq.clientId] = [...(db.rateCards[rfq.clientId] ?? []), row];
          created.push(row);
        }
      });
      rfq.status = created.length ? 'AWARDED' : 'LOST';
      return ok({ rfqId: rfq.id, status: rfq.status, rateCardLanesCreated: created });
    },
  ],

  /* ------------------------------------------------------------- C9 ----- */
  [
    'GET',
    /^\/reports\/today$/,
    ({ role }) => {
      const indents = scopeBranch(db.indents, role);
      const open = indents.filter((i) => i.stage === 'OPEN');
      const failures = indents.filter(
        (i) => ['OPEN', 'VENDOR_ASSIGNED'].includes(i.stage) && new Date(i.pickupDate).getTime() < Date.now(),
      );
      const trips = scopeBranch(db.trips, role);
      return ok({
        pendingAllocation: {
          stats: {
            waiting: open.length,
            freightAtStakePaise: open.reduce((a, i) => a + i.sellRatePaise, 0),
            noQuotes: open.filter((i) => i.quotes.length === 0).length,
            quotesIn: open.reduce((a, i) => a + i.quotes.length, 0),
            earliestPickup: open.map((i) => i.pickupDate).sort()[0] ?? null,
            tonnes: open.reduce((a, i) => a + i.weightTn, 0),
          },
          rows: open.map((i) => ({
            id: i.id,
            code: i.code,
            clientName: i.clientName,
            lane: `${i.fromCity} → ${i.toCity}`,
            weightTn: i.weightTn,
            truckType: i.truckType,
            pickupDate: i.pickupDate,
            sellRatePaise: i.sellRatePaise,
            quoteCount: i.quotes.length,
            branchName: i.branchName,
          })),
        },
        placementFailures: {
          stats: {
            failed: failures.length,
            freightLostPaise: failures.reduce((a, i) => a + i.sellRatePaise, 0),
            neverQuoted: failures.filter((i) => i.quotes.length === 0).length,
          },
          rows: failures.map((i) => ({
            id: i.id,
            code: i.code,
            clientName: i.clientName,
            lane: `${i.fromCity} → ${i.toCity}`,
            pickupDate: i.pickupDate,
            branchName: i.branchName,
            cause: i.failureCause ?? 'NO_QUOTE_AT_ALL',
            sellRatePaise: i.sellRatePaise,
          })),
        },
        vendorIssues: {
          rows: db.issues.filter((i) => i.status !== 'RESOLVED'),
        },
        podOverdue: {
          rows: trips
            .filter((t) => t.deliveredAt && !['APPROVED', 'WAIVED'].includes(t.podStatus))
            .map((t) => ({
              tripId: t.id,
              tripCode: t.code,
              lane: t.lane,
              vendorName: t.vendorName,
              ageDays: Math.floor((Date.now() - new Date(t.deliveredAt).getTime()) / 86_400_000),
              balanceHeldPaise: t.buyRatePaise - t.advancePaidPaise,
            })),
        },
      });
    },
  ],
  [
    'GET',
    /^\/reports\/home$/,
    ({ role }) => {
      const trips = scopeBranch(db.trips, role);
      const branchRows = [
        { branchName: 'Nashik', trips: 412, revenuePaise: 1864000000, costPaise: 1598000000 },
        { branchName: 'Pune', trips: 388, revenuePaise: 1721000000, costPaise: 1483000000 },
        { branchName: 'Vijayawada', trips: 301, revenuePaise: 1394000000, costPaise: 1226000000 },
        { branchName: 'Gandhidham', trips: 266, revenuePaise: 1538000000, costPaise: 1371000000 },
        { branchName: 'Hosur', trips: 194, revenuePaise: 987000000, costPaise: 872000000 },
      ].filter((b) => role !== 'BRANCH_MGR' || b.branchName === 'Nashik');
      const revenuePaise = branchRows.reduce((a, b) => a + b.revenuePaise, 0);
      const costPaise = branchRows.reduce((a, b) => a + b.costPaise, 0);
      return ok({
        month: {
          trips: branchRows.reduce((a, b) => a + b.trips, 0),
          revenuePaise,
          costPaise,
          marginPaise: revenuePaise - costPaise,
          vendorsUsed: 38,
          onTimePct: 91.4,
          placedByPickup: 1489,
          failures: 72,
          distinctTrucks: 412,
        },
        branches: branchRows,
        topClients: [
          { clientName: 'Berger Paints', revenuePaise: 2140000000 },
          { clientName: 'Apex Ceramics', revenuePaise: 1810000000 },
          { clientName: 'Sanghvi Metals', revenuePaise: 1290000000 },
        ],
        pod: {
          delivered: 1488,
          collected: 1351,
          pending: trips.filter((t) => !['APPROVED', 'WAIVED'].includes(t.podStatus)).length,
          withinTat: 1288,
          breached: 63,
          collectionPct: 90.8,
          penaltyAccruedPaise: 630000,
        },
        standing: {
          advanceOutstandingPaise: 18400000,
          balancePendingPaise: 31700000,
          receivablesPaise: 145200000,
          unbilledTrips: 41,
        },
      });
    },
  ],
  [
    'GET',
    /^\/pnl$/,
    ({ role }) => {
      const rows = [
        { period: 'Nashik', placementPaise: 1418000000, loadingPaise: 92000000, unloadingPaise: 61000000, detentionPaise: 21000000, otherPaise: 6000000, revenuePaise: 1864000000 },
        { period: 'Pune', placementPaise: 1329000000, loadingPaise: 82000000, unloadingPaise: 54000000, detentionPaise: 14000000, otherPaise: 4000000, revenuePaise: 1721000000 },
        { period: 'Vijayawada', placementPaise: 1104000000, loadingPaise: 71000000, unloadingPaise: 39000000, detentionPaise: 9000000, otherPaise: 3000000, revenuePaise: 1394000000 },
        { period: 'Gandhidham', placementPaise: 1241000000, loadingPaise: 79000000, unloadingPaise: 41000000, detentionPaise: 8000000, otherPaise: 2000000, revenuePaise: 1538000000 },
        { period: 'Hosur', placementPaise: 781000000, loadingPaise: 54000000, unloadingPaise: 29000000, detentionPaise: 6000000, otherPaise: 2000000, revenuePaise: 987000000 },
      ].filter((r) => role !== 'BRANCH_MGR' || r.period === 'Nashik');
      return ok({
        scope: role === 'BRANCH_MGR' ? 'Nashik only · pnl.view_all not granted' : 'All branches',
        rows: rows.map((r) => {
          const costPaise = r.placementPaise + r.loadingPaise + r.unloadingPaise + r.detentionPaise + r.otherPaise;
          return { ...r, costPaise, marginPaise: r.revenuePaise - costPaise };
        }),
      });
    },
  ],
  [
    'GET',
    /^\/pnl\/exceptions$/,
    ({ role }) =>
      ok(
        scopeBranch(db.trips, role)
          .filter((t) => t.charges.length === 0 && t.deliveredAt)
          .map((t) => ({
            tripId: t.id,
            tripCode: t.code,
            lane: t.lane,
            vendorName: t.vendorName,
            branchName: t.branchName,
            deliveredAt: t.deliveredAt,
            buyRatePaise: t.buyRatePaise,
          })),
      ),
  ],

  /* ------------------------------------------------------------ C10 ----- */
  ['GET', /^\/telematics$/, () => ok({ config: { overspeedKmph: db.config.overspeed_kmph, haltMinutes: db.config.halt_minutes, darkVehicleIntervalMinutes: db.config.dark_vehicle_interval_minutes }, vehicles: db.telematics })],

  /* ------------------------------------------------------------ C11 ----- */
  ['GET', /^\/admin\/import\/history$/, () => ok(db.importBatches)],
  [
    'POST',
    /^\/admin\/import\/([^/]+)\/commit$/,
    ({ params, body }) => {
      const batch = db.importBatches.find((b) => b.id === body?.batchId) ?? fail(404, 'NOT_FOUND', 'Batch not found');
      batch.status = 'COMMITTED';
      batch.committedAt = helpers.now();
      return ok({ ...batch, set: params[0] });
    },
  ],
  [
    'POST',
    /^\/admin\/import\/([^/]+)$/,
    ({ params }) => {
      const set = params[0];
      const batch = {
        id: `imp-${Date.now()}`,
        set,
        fileName: `${set}-upload.csv`,
        fileHash: 'd2a84f4b8b650937',
        rows: set === 'vendors' ? 214 : set === 'clients' ? 38 : 96,
        rejected: set === 'vendors' ? 3 : 0,
        actor: 'S. Krishnan',
        committedAt: null,
        status: 'DRY_RUN',
        report: {
          rowCount: set === 'vendors' ? 214 : set === 'clients' ? 38 : 96,
          rejects:
            set === 'vendors'
              ? [
                  { row: 41, reason: 'status=ACTIVE downgraded to PENDING_VERIFICATION (BR-01)' },
                  { row: 88, reason: 'TDS declaration missing (BR-03)' },
                  { row: 190, reason: 'Duplicate phone number' },
                ]
              : [],
          controlTotals:
            set === 'opening-balances'
              ? { suppliedPaise: 415200000, computedPaise: 415200000, reconciles: true }
              : null,
        },
      };
      db.importBatches.unshift(batch);
      return ok(batch);
    },
  ],
];

/* ---- adapter ------------------------------------------------------------ */

function currentRole(): RoleCode {
  if (typeof window === 'undefined') return 'OPS';
  return (localStorage.getItem('role') as RoleCode) ?? 'OPS';
}

function envelope(config: AxiosRequestConfig, httpStatus: number, data: any): AxiosResponse {
  return {
    data: { success: true, data },
    status: httpStatus,
    statusText: 'OK',
    headers: {},
    config: config as any,
  };
}

export const mockAdapter: AxiosAdapter = async (config) => {
  const method = (config.method ?? 'get').toUpperCase();
  const [rawPath, rawQuery] = (config.url ?? '').split('?');
  const path = rawPath.replace(/\/$/, '') || '/';
  const query = new URLSearchParams(rawQuery ?? '');
  // Axios only serialises `config.params` into the URL inside its own
  // built-in adapters (xhr/http) — a custom adapter like this one receives
  // them as a separate object and must merge them in itself, or every list
  // filter that uses the `params` option (as opposed to a hand-built query
  // string) silently does nothing.
  if (config.params && typeof config.params === 'object') {
    Object.entries(config.params as Record<string, unknown>).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
  }
  const body = typeof config.data === 'string' ? safeParse(config.data) : config.data;
  const headers = normaliseHeaders(config.headers);

  // A visible pause; the console is never demonstrated against instant data.
  await new Promise((r) => setTimeout(r, 120));

  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const match = pattern.exec(path);
    if (!match) continue;
    try {
      const result = handler({
        params: match.slice(1),
        query,
        body,
        role: currentRole(),
        headers,
      });
      if (result && typeof result === 'object' && '__status' in result)
        return envelope(config, (result as any).__status, (result as any).body);
      return envelope(config, 200, result);
    } catch (e) {
      const err = e as MockHttpError;
      throw new AxiosError(err.message, String(err.httpStatus), config as any, null, {
        data: {
          success: false,
          statusCode: err.httpStatus,
          path,
          timestamp: helpers.now(),
          error: { code: err.code, message: err.message, details: err.details },
        },
        status: err.httpStatus,
        statusText: 'Error',
        headers: {},
        config: config as any,
      });
    }
  }

  throw new AxiosError(`No mock for ${method} ${path}`, '404', config as any, null, {
    data: {
      success: false,
      statusCode: 404,
      path,
      timestamp: helpers.now(),
      error: { code: 'NO_MOCK', message: `No fixture for ${method} ${path}` },
    },
    status: 404,
    statusText: 'Not Found',
    headers: {},
    config: config as any,
  });
};

function safeParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normaliseHeaders(headers: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!headers) return out;
  const source = typeof headers.toJSON === 'function' ? headers.toJSON() : headers;
  Object.entries(source).forEach(([k, v]) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

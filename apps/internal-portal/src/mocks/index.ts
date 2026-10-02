import { planRecovery } from './sdr-recovery';
import { computeTransitPenalty } from './transit-penalty';
import { bandPositionFor } from './band-position';
import { isDemoData, loadPeople, persist, savePeople } from './persist';
import { fileFor, keepFile } from './files';
import { AxiosAdapter, AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { RoleCode, SEED_GRANTS } from '@/lib/permissions';
import {
  ACCOUNTS,
  ADVANCE_DOCUMENT_SET,
  missingTripDocs,
  BRANCHES,
  CREDENTIALS,
  type FixtureAccount,
  DEMO_CODE,
  DOC_LABEL,
  SUPPLY_SOURCE_LABEL,
  USERS,
  db,
  helpers,
} from './db';

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

/* ---- sign-in: the stand-in for Supabase Auth ---------------------------- */

/**
 * With mocks off, `lib/auth.ts` posts to Supabase's `/auth/v1/token` and gets
 * back a real RS256 JWT that internal-api verifies against JWKS. Nothing in
 * this file is reachable on that path. What follows is the same exchange
 * against fixture accounts, for the default local mode where no Supabase
 * instance is running.
 *
 * The tokens are JWT-*shaped* — three base64url segments, `sub`/`email`/
 * `exp` claims, decoded by the same "read the bearer, resolve a principal"
 * step the real guard performs — but the header says `"alg":"none"` and the
 * third segment is the literal word `mock`, so a token that ever escaped
 * into a real deployment would be rejected by `jose` on sight rather than
 * quietly resembling a credential.
 *
 * This replaces six hand-signed JWTs that used to be pasted into
 * `lib/dev-tokens.ts`. Those carried a fixed `exp` and had silently expired,
 * which took every non-mock sign-in down with them; a token minted at
 * sign-in cannot go stale on the shelf.
 */

const ACCESS_TTL_MS = 3_600_000; // One hour — Supabase's own default.
const REFRESH_TTL_MS = 30 * 86_400_000;

interface MockClaims {
  sub: string;
  email: string;
  role: RoleCode;
  /**
   * Branch code, or `null` for someone who sees every branch.
   *
   * On the token because that is where the real system keeps it:
   * `auth.service.ts` returns `branch: user.branch` per user. Deriving it
   * from the role instead — which this fixture did until the BRANCH_MGR merge
   * made scoping a property of the person — cannot represent two people of
   * the same role on different branches, which is now the ordinary case.
   */
  branch: string | null;
  typ: 'access' | 'refresh';
  exp: number;
  /**
   * Makes every minted token distinct. Without it the claims are derived
   * purely from the clock, so a refresh landing in the same millisecond as
   * the sign-in it replaces returns a byte-identical string — which is not
   * how any real token endpoint behaves, and quietly turns "did this
   * rotate?" into a question the tests can only answer by sleeping.
   */
  jti: number;
}

let minted = 0;

const b64url = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (value: string) =>
  atob(value.replace(/-/g, '+').replace(/_/g, '/'));

function mint(account: FixtureAccount, typ: 'access' | 'refresh'): string {
  const claims: MockClaims = {
    sub: account.userId,
    email: account.email,
    role: account.role,
    branch: account.branch,
    typ,
    exp: Date.now() + (typ === 'access' ? ACCESS_TTL_MS : REFRESH_TTL_MS),
    jti: (minted += 1),
  };
  return [
    b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'mock' })),
    b64url(JSON.stringify(claims)),
    'mock',
  ].join('.');
}

/**
 * `EXPIRED` is kept apart from `INVALID` because the two want different
 * handling: a token that merely aged out is refreshable and the caller should
 * retry, while a malformed or tampered one never will be and the session is
 * simply over.
 */
type TokenResult =
  | { ok: true; claims: MockClaims }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' };

function readToken(token: string | null | undefined, typ: 'access' | 'refresh'): TokenResult {
  const invalid = { ok: false, reason: 'INVALID' } as const;
  if (!token) return invalid;
  const segments = token.split('.');
  if (segments.length !== 3 || segments[2] !== 'mock') return invalid;
  try {
    const claims = JSON.parse(unb64url(segments[1])) as MockClaims;
    if (claims.typ !== typ || !(claims.role in USERS)) return invalid;
    if (!claims.exp) return invalid;
    if (claims.exp <= Date.now()) return { ok: false, reason: 'EXPIRED' };
    return { ok: true, claims };
  } catch {
    return invalid;
  }
}

function issue(account: FixtureAccount) {
  return {
    accessToken: mint(account, 'access'),
    refreshToken: mint(account, 'refresh'),
    expiresAt: Date.now() + ACCESS_TTL_MS,
  };
}

/** Emails an administrator switched off on the Allowed emails screen (mock mode). */
const DISABLED_EMAILS = new Set<string>();
const ALLOWED_AT: Record<string, string> = {};

/**
 * Admin → Users changes are kept in the browser like the rest of the working
 * data. Without this, a person an administrator added (or renamed, moved, or
 * switched off) vanished on the next reload, and the other desks never saw it.
 * The fixture accounts stay the base; saved changes are laid over them by id.
 */
(function restorePeople() {
  const saved = loadPeople();
  if (!saved) return;
  for (const a of saved.accounts) {
    const existing = ACCOUNTS.find((x) => x.userId === a.userId);
    const account = existing ?? ({} as FixtureAccount);
    Object.assign(account, { ...a, role: a.role as RoleCode });
    if (!existing) ACCOUNTS.push(account);
  }
  for (const key of Object.keys(CREDENTIALS)) delete CREDENTIALS[key];
  for (const a of ACCOUNTS) CREDENTIALS[a.email.toLowerCase()] = a;
  for (const e of saved.disabled ?? []) DISABLED_EMAILS.add(e);
  Object.assign(ALLOWED_AT, saved.allowedAt ?? {});
})();

function rememberPeople() {
  savePeople({
    accounts: ACCOUNTS.map(({ userId, name, email, role, branch }) => ({ userId, name, email, role, branch })),
    disabled: [...DISABLED_EMAILS],
    allowedAt: { ...ALLOWED_AT },
  });
}

/** Mirrors Supabase refusing a code for an email with no login (`create_user: false`). */
export async function mockSendCode(email: string) {
  await new Promise((r) => setTimeout(r, 260));
  const key = email.trim().toLowerCase();
  if (!CREDENTIALS[key] || DISABLED_EMAILS.has(key)) {
    throw new Error('This email is not allowed to sign in. Ask an administrator to add it.');
  }
}

export async function mockVerifyCode(email: string, code: string) {
  await new Promise((r) => setTimeout(r, 260));
  const account = CREDENTIALS[email.trim().toLowerCase()];
  if (!account || DISABLED_EMAILS.has(account.email.toLowerCase()) || code.trim() !== DEMO_CODE) {
    throw new Error('That code is wrong or has expired. Check the latest email, or send a new code.');
  }
  return issue(account);
}

function allowedEmailView(a: FixtureAccount) {
  const branch = a.branch ? BRANCHES.find((b) => b.code === a.branch) : null;
  return {
    id: a.userId,
    email: a.email,
    name: a.name,
    role: a.role,
    branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
    status: DISABLED_EMAILS.has(a.email.toLowerCase()) ? 'DISABLED' : 'ACTIVE',
    canSignIn: true,
    createdAt: ALLOWED_AT[a.userId] ?? '2026-08-14T09:00:00.000Z',
  };
}

export async function mockRefresh(refreshToken: string) {
  const result = readToken(refreshToken, 'refresh');
  if (!result.ok) throw new Error('This session has expired. Sign in again.');
  // Resolved by `sub`, not by role: refreshing Sunita Rao's session must not
  // hand back the unscoped Operations account and quietly widen her scope.
  const account = ACCOUNTS.find((a) => a.userId === result.claims.sub);
  if (!account) throw new Error('This session has expired. Sign in again.');
  return issue(account);
}

/**
 * Test seam. `e2e/helpers.ts` seeds `localStorage.token` before first
 * navigation so a spec can start as a given role without driving the sign-in
 * form fifteen times over. It mints through this rather than hardcoding a
 * token, so the format can never drift out from under the suite — which is
 * precisely how the checked-in dev tokens managed to expire unnoticed.
 */
export function mintAccessToken(who: RoleCode | FixtureAccount): string {
  return mint(typeof who === 'string' ? USERS[who] : who, 'access');
}

/**
 * The scoped fixture account for a role, if one exists.
 *
 * `USERS[role]` can only ever answer with the role's default person, who is
 * always unscoped — so a spec that wants to prove branch narrowing has to ask
 * for the branched account by name.
 */
export function branchedAccount(role: RoleCode): FixtureAccount | undefined {
  return ACCOUNTS.find((a) => a.role === role && a.branch !== null);
}

/**
 * Every fixture account, for the sign-in screen's demo list — including the
 * branched one, so signing in as a scoped person is demonstrable rather than
 * only reachable from a test.
 */
export function mockAccounts(): { email: string; name: string; role: RoleCode; branch: string | null }[] {
  return ACCOUNTS.map(({ email, name, role, branch }) => ({ email, name, role, branch }));
}

interface Ctx {
  params: string[];
  query: URLSearchParams;
  body: any;
  role: RoleCode;
  /**
   * The signed-in person's branch code, or `null` for all-branches.
   *
   * Sits beside `role` rather than being looked up from it, because after the
   * BRANCH_MGR merge two people can share a role and see different branches.
   * Read from the token, which is where the real API reads it from too.
   */
  branch: string | null;
  /** The signed-in person, from the token's `sub`. */
  userId: string;
  headers: Record<string, any>;
}

type Result = any | { __status: number; body: any };
type Handler = (ctx: Ctx) => Result | Promise<Result>;

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

/**
 * Raise the fixture's version of an API error.
 *
 * Two things here are load-bearing, and the second is easy to get wrong.
 *
 * **`: never`.** Without it the return type infers as `void`, so
 * `if (!row) fail(404, …)` does not narrow `row` and the next line is a type
 * error — while `const row = find(…) ?? fail(404, …)` happens to narrow fine.
 * Two forms, only one of which silently works, across 80-odd call sites: a
 * trap that catches whoever reaches for the more readable one.
 *
 * **A `function` declaration, not `const fail = (…) => …`.** TypeScript only
 * applies never-returning control-flow analysis when the callee is a function
 * declaration or a name with an explicit type annotation. An arrow assigned to
 * an un-annotated `const` does not qualify *even with* `: never` on the arrow
 * — which was the state this file was in, and why annotating the return type
 * alone did not fix anything. Verified both ways round rather than assumed.
 *
 * Same purpose as `assertNever` in the orders ladder: fix the mechanism so the
 * mistake cannot be made, rather than each instance of it.
 */
function fail(httpStatus: number, code: string, message: string, details?: unknown): never {
  throw new MockHttpError(httpStatus, code, message, details);
}

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

const tripForIndent = (indent: any) => db.trips.find((t: any) => t.indentId === indent.id);

/** What the indent screens receive: the record plus the trip an award generated, if any. */
function indentView(indent: any) {
  const trip = tripForIndent(indent);
  return { ...indent, tripId: trip?.id ?? null, tripCode: trip?.code ?? null };
}

/** Opens the trip for an indent. `vehicleNo` is '' until a vehicle is allocated. */
function openTripFor(indent: any) {
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
    vehicleNo: indent.vehicleNo ?? '',
    vehicleType: indent.truckType,
    capacityTn: indent.weightTn,
    driverName: indent.driverName ?? null,
    driverLicence: indent.driverLicence ?? null,
    driverPhone: indent.driverPhone ?? null,
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
    documents: missingTripDocs(),
    charges: [],
    lr: null,
    loadingSupervisorId: null,
    loadingSupervisorName: null,
    loadingStartedAt: null,
    loadingCompletedAt: null,
    departedAt: null,
    transitPenaltyPaise: 0,
  };
  db.trips.unshift(trip);
  return trip;
}

/**
 * A transporter's own fleet row follows its truck through a trip:
 * AVAILABLE → ON_TRIP when it is allocated, back to AVAILABLE (at the
 * delivery city) once it is delivered. DOCS_DUE and MAINTENANCE are never
 * overwritten — those are set for a reason nothing here knows about. A plate
 * that is not in their fleet (a truck they never listed) is simply skipped.
 */
function fleetRow(vendorId: string | null | undefined, vehicleNo: string | null | undefined) {
  if (!vendorId || !vehicleNo) return undefined;
  const plate = String(vehicleNo).replace(/\s/g, '').toUpperCase();
  const vendor = db.vendors.find((v: any) => v.id === vendorId) as any;
  return (vendor?.fleet ?? []).find((f: any) => String(f.registration).replace(/\s/g, '').toUpperCase() === plate);
}

function setFleetVehicleStatus(
  vendorId: string | null | undefined,
  vehicleNo: string | null | undefined,
  status: 'AVAILABLE' | 'ON_TRIP',
  currentCity?: string,
) {
  const row = fleetRow(vendorId, vehicleNo);
  if (!row || row.status === 'DOCS_DUE' || row.status === 'MAINTENANCE') return;
  row.status = status;
  if (currentCity) row.currentCity = currentCity;
}

/** The truck previously allocated to a load goes back to AVAILABLE when it is swapped or the load is set aside. */
function releaseFleetVehicle(vendorId: string | null | undefined, vehicleNo: string | null | undefined) {
  const row = fleetRow(vendorId, vehicleNo);
  if (row?.status === 'ON_TRIP') row.status = 'AVAILABLE';
}

/** Where the main pickup cities are, so a truck that has just left appears on the fleet board in the right place. */
const CITY_COORDS: Record<string, [number, number]> = {
  kolkata: [22.5726, 88.3639],
  nashik: [19.9975, 73.7898],
  pune: [18.5204, 73.8567],
  mumbai: [19.076, 72.8777],
  hosur: [12.7409, 77.8253],
  gurugram: [28.4595, 77.0266],
  vijayawada: [16.5062, 80.648],
  visakhapatnam: [17.6868, 83.2185],
  gandhidham: [23.0753, 70.1337],
  jaipur: [26.9124, 75.7873],
  guwahati: [26.1445, 91.7362],
  hyderabad: [17.385, 78.4867],
  bhiwandi: [19.2813, 73.0483],
  surat: [21.1702, 72.8311],
};

/** A whole lorry receipt for a trip that has none yet — every block present, so the screen never meets a missing one. */
function blankLr(trip: any) {
  return {
    code: null,
    status: 'DRAFT',
    lrDate: null,
    bookedAt: null,
    sharedAt: null,
    consignor: { name: trip.clientName ?? '', address: '', gstin: '' },
    consignee: { name: '', address: '', gstin: '' },
    goods: { description: '', packages: 0, weightTn: trip.weightTn ?? 0, valuePaise: 0 },
    invoice: { number: '', datedOn: '', valuePaise: 0 },
    eway: { number: '', validTill: '' },
    vehicle: { registration: trip.vehicleNo ?? '', type: trip.vehicleType ?? '' },
    driver: { name: trip.driverName ?? '', licence: trip.driverLicence ?? '', phone: '' },
    transitDays: trip.transitDaysRequired ?? 0,
    remarks: trip.remarks ?? '',
    chargeHeads: { freightPaise: trip.sellRatePaise ?? 0, loadingPaise: 0, unloadingPaise: 0, detentionPaise: 0, otherPaise: 0, discountPaise: 0 },
  };
}

/** The award itself: buy rate written, quote accepted, trip generated. Mirrors `applyAward`. */
function applyMockAward(indent: any, quote: any) {
  const vendor = db.vendors.find((v) => v.id === quote.vendorId);
  indent.buyRatePaise = quote.amountPaise;
  indent.vendorId = quote.vendorId;
  indent.awardedQuoteId = quote.id;
  indent.stage = 'TRIP_CREATED';
  // An order that asked for its own advance keeps it; otherwise the
  // vendor's standing policy applies.
  if (!indent.advancePctOverridden) indent.advancePct = vendor?.advancePct ?? indent.advancePct;
  quote.status = 'ACCEPTED';
  indent.quotes.filter((q: any) => q.id !== quote.id).forEach((q: any) => (q.status = 'REJECTED'));
  // A load whose transporter was reassigned keeps its trip: the one that was set aside
  // comes back to life for the new transporter, so an indent never carries two trip numbers.
  const setAside = db.trips.find((t: any) => t.indentId === indent.id && t.stage === 'CANCELLED');
  if (setAside) {
    Object.assign(setAside, {
      stage: 'OPEN',
      vendorId: indent.vendorId,
      vendorName: db.vendors.find((v) => v.id === indent.vendorId)?.legalName ?? '—',
      buyRatePaise: indent.buyRatePaise,
      vehicleNo: '',
      driverName: null,
      driverLicence: null,
      loadingSupervisorId: null,
      loadingSupervisorName: null,
      loadingStartedAt: null,
      loadingCompletedAt: null,
      departedAt: null,
      documents: missingTripDocs(),
      lr: null,
      lrCode: null,
    });
    return setAside;
  }
  return openTripFor(indent);
}

/** Every change to an indent counts as somebody having looked at it. */
function touchIndent(indent: any) {
  indent.updatedAt = helpers.now();
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
  /** What to replay when this is approved — only kinds the fixture actually executes carry one. */
  action?: Record<string, unknown>;
}) {
  const approval = {
    action: input.action,
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

/** Lanes proposed for a client, still waiting for approval — `RateRevisionService.pendingLanes`. */
/** Only Leadership or an administrator delete a rate; a reason is kept. Mirrors `assertCanDeleteRates`. */
function rateDeleteReason(role: string, body: any): string {
  if (role !== 'LEADERSHIP' && role !== 'ADMIN')
    fail(403, 'PERMISSION_DENIED', 'Only Leadership or an administrator can delete a rate.');
  const why = String(body?.reason ?? '').trim();
  if (why.length < 10) fail(400, 'REASON_TOO_SHORT', 'Say why this rate is being deleted (at least 10 characters).');
  return why;
}

function pendingLanesFor(clientId: string) {
  return db.approvals
    .filter((a: any) => a.kind === 'RATE_CARD_LANE' && a.status === 'PENDING' && a.entityId === clientId && a.action)
    .map((a: any) => ({
      approvalId: a.id,
      requesterName: a.requesterName,
      proposedAt: a.createdAt,
      origin: a.action.origin,
      destination: a.action.destination,
      truckType: a.action.truckType,
      ratePaise: a.action.ratePaise,
      rateBasis: a.action.rateBasis ?? 'FTL',
      transitDays: a.action.transitDays,
      validFrom: a.action.validFrom,
      validTo: a.action.validTo ?? null,
    }));
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
/** What a trip cost us: the buy rate plus the charges captured against it. */
const tripCost = (t: any) =>
  (t.buyRatePaise ?? 0) + (t.charges ?? []).reduce((a: number, c: any) => a + (c.costAmountPaise ?? 0), 0);

/** The dashboards, worked out from the records that are actually in the console. */
function liveStats(trips: any[]) {
  const delivered = trips.filter((t) => t.deliveredAt);
  const onTime = delivered.filter(
    (t) => t.actualTransitDays != null && t.transitDaysRequired != null && t.actualTransitDays <= t.transitDaysRequired,
  );
  const measured = delivered.filter((t) => t.actualTransitDays != null && t.transitDaysRequired != null);
  const collected = delivered.filter((t) => ['RECEIVED', 'VERIFIED', 'APPROVED', 'WAIVED'].includes(t.podStatus));
  const ageOf = (t: any) => Math.floor((Date.now() - new Date(t.deliveredAt).getTime()) / 86_400_000);
  const byClient = new Map<string, number>();
  for (const t of trips) byClient.set(t.clientName, (byClient.get(t.clientName) ?? 0) + (t.sellRatePaise ?? 0));
  return {
    vendorsUsed: new Set(trips.map((t) => t.vendorId)).size,
    onTimePct: measured.length ? Math.round((onTime.length / measured.length) * 1000) / 10 : 0,
    placedByPickup: trips.filter((t) => t.vehicleNo).length,
    failures: db.indents.filter((i: any) => i.failureCause).length,
    distinctTrucks: new Set(trips.map((t) => t.vehicleNo).filter(Boolean)).size,
    delivered: delivered.length,
    collected: collected.length,
    withinTat: delivered.filter((t) => ageOf(t) <= db.config.pod_tat_days).length,
    breached: delivered.filter((t) => ageOf(t) > db.config.pod_tat_days).length,
    collectionPct: delivered.length ? Math.round((collected.length / delivered.length) * 1000) / 10 : 0,
    penaltyAccruedPaise: trips.reduce((a, t) => a + (t.podPenaltyPaise ?? 0) + (t.transitPenaltyPaise ?? 0), 0),
    advanceOutstandingPaise: trips
      .filter((t) => t.stage !== 'CLOSED')
      .reduce((a, t) => a + Math.max(0, (t.advancePaidPaise ?? 0)), 0),
    balancePendingPaise: delivered
      .filter((t) => !(t.balancePaidPaise > 0))
      .reduce((a, t) => a + Math.max(0, (t.buyRatePaise ?? 0) - (t.advancePaidPaise ?? 0)), 0),
    receivablesPaise: db.invoices
      .filter((i: any) => i.code && i.status !== 'CANCELLED')
      .reduce((a: number, i: any) => a + Math.max(0, (i.totalPaise ?? 0) - (i.receivedPaise ?? 0)), 0),
    unbilledTrips: delivered.filter((t) => !t.billed).length,
    topClients: [...byClient.entries()]
      .map(([clientName, revenuePaise]) => ({ clientName, revenuePaise }))
      .sort((a, b) => b.revenuePaise - a.revenuePaise)
      .slice(0, 3),
  };
}

/** One row per branch that has trips, worked out from them. */
function branchRowsFor(trips: any[]) {
  return BRANCHES.map((b) => {
    const own = trips.filter((t) => t.branchId === b.id);
    return {
      branchName: b.name,
      trips: own.length,
      revenuePaise: own.reduce((a, t) => a + (t.sellRatePaise ?? 0), 0),
      costPaise: own.reduce((a, t) => a + tripCost(t), 0),
    };
  }).filter((r) => r.trips > 0);
}

/** Records a shortage / damage against a delivered trip — from the SDR screen, or from a proof's remarks. */
function raiseSdrRecord(trip: any, kind: string, description: string, claimedPaise: number, role: RoleCode) {
  const record = {
    id: `sdr-${db.sdr.length + 1}-${Date.now()}`,
    code: nextNumber('SDR'),
    tripId: trip.id,
    tripCode: trip.code,
    vendorId: trip.vendorId,
    vendorName: trip.vendorName,
    kind,
    description: description.trim(),
    claimedPaise,
    status: 'OPEN',
    deductionPaise: null,
    outstandingPaise: 0,
    resolutionNote: null,
    waivedPaise: 0,
    raisedByName: USERS[role].name,
    raisedAt: helpers.now(),
    resolvedByName: null,
    resolvedAt: null,
  };
  db.sdr.unshift(record);
  return record;
}

/** An SDR row with where its deduction has been recovered from. */
function withRecoveries(record: any) {
  return {
    ...record,
    waivedPaise: record.waivedPaise ?? 0,
    recoveries: db.sdrRecoveries
      .filter((r: any) => r.sdrId === record.id)
      .map((r: any) => {
        const t = db.trips.find((x: any) => x.id === r.tripId);
        return { tripId: r.tripId, tripCode: t?.code ?? r.tripId, amountPaise: r.amountPaise, at: r.at ?? helpers.now() };
      }),
  };
}

/** Resolved records for this transporter that still have something to take, as the planner wants them. */
function sdrCandidates(vendorId: string) {
  return db.sdr
    .filter((s) => s.vendorId === vendorId && s.status === 'RESOLVED' && s.outstandingPaise > 0)
    .map((s) => ({
      id: s.id,
      code: s.code,
      tripId: s.tripId,
      tripCode: s.tripCode,
      outstandingPaise: s.outstandingPaise,
      resolvedAt: s.resolvedAt,
    }));
}

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
  // An E-POD closes the delivery; the balance waits for the hard copy to be uploaded and verified.
  const podReceipt = db.podReceipts.find((r) => r.tripId === trip.id);
  if (podReceipt?.podKind === 'EPOD' && !podReceipt.hardCopyVerifiedAt) {
    const uploaded = (podReceipt.hardCopyAttachmentIds ?? []).length > 0;
    unmet.push({
      key: 'HPOD_PENDING',
      label: uploaded
        ? 'Hard copy (H-POD) uploaded but not yet verified'
        : 'Only the E-POD is in — upload and verify the hard copy (H-POD)',
      state: uploaded ? 'UNVERIFIED' : 'MISSING',
    });
  }
  if (podAgeDays > db.config.pod_forfeit_days)
    unmet.push({ key: 'FORFEIT', label: `POD past ${db.config.pod_forfeit_days} days — balance forfeited`, state: 'BLOCKED' });
  const openSdr = db.sdr.filter((s) => s.tripId === trip.id && s.status === 'OPEN').length;
  if (openSdr > 0)
    unmet.push({
      key: 'SDR_OPEN',
      label: `${openSdr} shortage or damage record${openSdr === 1 ? ' is' : 's are'} still open`,
      state: 'BLOCKED',
    });

  const chargeCostPaise = (trip.charges ?? []).reduce((a: number, c: any) => a + c.costAmountPaise, 0);
  const billablePaise = trip.buyRatePaise + chargeCostPaise;
  const grossPaise = billablePaise - (trip.advancePaidPaise ?? 0);
  const penaltyPaise = trip.podStatus === 'WAIVED' || trip.podPenaltyWaived ? 0 : (trip.podPenaltyPaise ?? 0);
  const transitPenaltyPaise = trip.transitPenaltyPaise ?? 0;
  const transitLateDays =
    trip.actualTransitDays != null && trip.transitDaysRequired != null
      ? Math.max(0, trip.actualTransitDays - trip.transitDaysRequired)
      : 0;
  const sdr = planRecovery(
    sdrCandidates(trip.vendorId),
    trip.id,
    grossPaise - penaltyPaise - transitPenaltyPaise,
    db.config.min_balance_payable_paise ?? 0,
  );
  const netPaise = sdr.netPaise;
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
      transitPenaltyPaise,
      transitLateDays,
      grossPaise,
      sdrDeductionPaise: sdr.totalPaise,
      sdrLines: sdr.recoveries.map((r) => ({
        code: r.sdrCode,
        tripCode: r.tripCode,
        amountPaise: r.amountPaise,
        carriedForward: !r.ownTrip,
        remainingAfterPaise: r.remainingAfterPaise,
      })),
      carriedForwardPaise: sdr.carriedForwardPaise,
      netPaise,
    },
    sdrPlan: sdr,
  };
}

function roleCan(role: string, permission: string): boolean {
  return ((SEED_GRANTS as Record<string, string[]>)[role] ?? []).includes(permission);
}

/** One line on a trip's tracking sheet — same shape as `TripsService.trackingSheet`'s updates. */
function addTrackingRow(
  trip: any,
  row: { kind: string; location: string; lat: number | null; lng: number | null; note: string | null; at: string; userId: string | null; status?: string | null },
) {
  db.tripTracking.push({
    status: row.status ?? null,
    id: `trk-${Date.now()}-${db.tripTracking.length + 1}`,
    tripId: trip.id,
    kind: row.kind,
    location: row.location,
    lat: row.lat,
    lng: row.lng,
    note: row.note,
    recordedAt: row.at,
    recordedByName: ACCOUNTS.find((a) => a.userId === row.userId)?.name ?? null,
  });
}

function trackingSheetFor(trip: any) {
  const [fromCity, toCity] = String(trip.lane ?? '').split('→').map((x: string) => x.trim());
  return {
    eway: (() => {
      const doc = (trip.documents ?? []).find((d: any) => d.kind === 'EWAY_BILL');
      return {
        ewayNo: doc?.keyedValues?.ewayNo ?? trip.ewayNo ?? null,
        validTill: doc?.keyedValues?.validTill ?? trip.ewayValidTill ?? null,
        uploaded: !!doc?.attachmentId && doc?.status !== 'MISSING',
      };
    })(),
    tripId: trip.id,
    stage: trip.stage,
    vehicleNo: trip.vehicleNo || null,
    fromCity: fromCity || null,
    toCity: toCity || null,
    reachedLoadingAt: trip.reachedLoadingAt ?? null,
    loadedAt: trip.loadingCompletedAt ?? null,
    departedAt: trip.departedAt ?? null,
    reachedDestinationAt: trip.reachedDestinationAt ?? null,
    deliveredAt: trip.deliveredAt ?? null,
    updates: db.tripTracking
      .filter((u: any) => u.tripId === trip.id)
      .sort((a: any, b: any) => String(a.recordedAt).localeCompare(String(b.recordedAt))),
  };
}

/**
 * Puts a trip on the road — `TripsService.depart`. Vehicle allocated, the
 * truck marked loaded, the advance documents uploaded (not yet verified), and
 * any lorry receipt that was started issued.
 */
function departMockTrip(trip: any, userId: string | null) {
  if (trip.stage !== 'OPEN') fail(409, 'NOT_OPEN', `Trip ${trip.code} is not OPEN (currently ${trip.stage}).`);
  if (!trip.vehicleNo) fail(409, 'NOT_PLACED', 'Allocate the vehicle before the trip can start.');
  // The LR is "if needed". Only a started, unissued one blocks.
  if (trip.lr && trip.lr.status !== 'RELEASED') {
    fail(409, 'LR_NOT_GENERATED', 'A lorry receipt was started for this trip — issue it before departure, or it travels unissued.');
  }
  const missingDocs = advanceGate(trip).unmet.filter((u: any) => u.state === 'MISSING' || u.state === 'REJECTED');
  if (missingDocs.length)
    fail(409, 'ADVANCE_DOCS_NOT_UPLOADED', 'The advance documents are not all uploaded yet.', { unmet: missingDocs });
  if (!trip.loadingCompletedAt) fail(409, 'LOADING_NOT_COMPLETE', 'Mark the truck as loaded first.');
  trip.stage = 'IN_TRANSIT';
  trip.departedAt = helpers.now();
  const [from] = String(trip.lane ?? '').split('→').map((x: string) => x.trim());
  addTrackingRow(trip, { kind: 'DEPARTED', location: from || 'Loading point', lat: null, lng: null, note: null, at: trip.departedAt, userId });
  // Once the truck is moving it is on the fleet board, starting from where it loaded.
  if (trip.vehicleNo && !db.telematics.some((v: any) => v.vehicleNo === trip.vehicleNo)) {
    const [lat, lng] = CITY_COORDS[(from ?? '').toLowerCase()] ?? [20.5937, 78.9629];
    const eway = (trip.documents ?? []).find((d: any) => d.kind === 'EWAY_BILL');
    db.telematics.unshift({
      vehicleNo: trip.vehicleNo,
      tripCode: trip.code,
      vendorName: trip.vendorName,
      lane: trip.lane,
      progressPct: 0,
      speedKmph: 0,
      fuelPct: 100,
      lastPingAt: helpers.now(),
      lat,
      lng,
      ewayValidTill: eway?.keyedValues?.validTill ? `${eway.keyedValues.validTill}T23:59:00+05:30` : null,
      alerts: [],
    });
  }
  if (trip.lr) trip.lr = { ...trip.lr, status: 'IN_TRANSIT' };
  return trip;
}

function tripSummary(t: any) {
  return {
    id: t.id,
    code: t.code,
    clientId: t.clientId ?? null,
    indentId: t.indentId ?? null,
    departedAt: t.departedAt ?? null,
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
    balancePaidPaise: t.balancePaidPaise,
    podPenaltyPaise: t.podPenaltyPaise,
  };
}

/**
 * The branch a signed-in user is scoped to, or null for someone who sees the
 * whole company. Scoping is a property of the *user* now, not of their role —
 * BRANCH_MGR is gone and Operations absorbed it, so the only thing that can
 * narrow a view is whether that person has a branch on their record — which
 * is now read from the token's `branch` claim, per user, exactly as
 * `auth.service.ts` does it.
 *
 * This used to read `USERS[role].branch`, a role-keyed lookup that could not
 * express two people of one role on different branches. That made mock mode
 * structurally unable to reproduce per-user scoping, so "mock mode shows all
 * branches" was evidence of nothing. It is the caller's own branch now, so it
 * is evidence again.
 */
function scopedBranch(code: string | null) {
  return code ? (BRANCHES.find((b) => b.code === code) ?? null) : null;
}

function scopeBranch(rows: any[], code: string | null) {
  const branch = scopedBranch(code);
  if (!branch) return rows;
  return rows.filter((r) => r.branchId === branch.id || r.branchName === branch.name);
}

/* ---- orders — the ten-step spine ----------------------------------------
   One copy of the ladder, mirroring `OrdersService.ladder()` in internal-api.

   The point of the orders endpoint is that the list and the detail cannot
   disagree, so the fixture adapter has to honour that too: both routes below
   call this one function. The old browser-side version ran the ladder twice
   with different inputs, which is exactly the bug being removed. */

const ORDER_LADDER = [
  'INDENT_CREATED',
  'TRIP_GENERATED',
  'LR_ISSUED',
  'ADVANCE_DOCS_UPLOADED',
  'ADVANCE_PAID',
  'TRACKING',
  'UNLOADED',
  'POD_UPLOADED',
  'POD_VERIFIED',
  'BALANCE_RELEASED',
] as const;

type MockOrderStatus = (typeof ORDER_LADDER)[number] | 'FAILED' | 'POD_FORFEITED' | 'CANCELLED';

const orderStepNo = (status: MockOrderStatus) =>
  status === 'FAILED' ? 1 : status === 'POD_FORFEITED' ? 9 : ORDER_LADDER.indexOf(status as never) + 1;

/**
 * Which configured advance documents are in — present and not rejected.
 *
 * "In" deliberately does not mean verified: step 4 is "advance papers in",
 * and checking them is the advance gate's own job. But a REJECTED paper is
 * one somebody has to send again, so it does not count — otherwise rejecting
 * a document would move nothing, and the ladder would disagree with the
 * advance gate, which already treats REJECTED as unmet.
 */
export function advanceDocsUploaded(trip: any): boolean {
  const set: string[] = db.config.advance_document_set ?? [];
  if (set.length === 0) return true;
  return set.every((kind) => {
    const doc = (trip.documents ?? []).find((d: any) => d.kind === kind);
    return Boolean(doc) && doc.status !== 'MISSING' && doc.status !== 'REJECTED';
  });
}

export function orderLadder(indent: any, trip: any): MockOrderStatus {
  if (indent.stage === 'CANCELLED') return 'CANCELLED';
  if (indent.failureCause && indent.stage === 'OPEN') return 'FAILED';
  if (indent.stage !== 'TRIP_CREATED') return 'INDENT_CREATED';
  if (!trip) return 'TRIP_GENERATED';

  // Where the truck is outranks the paperwork behind it — see `order-ladder.ts`.
  // Steps 3–5 only describe a truck that has not left yet; a truck that has
  // departed with its advance still unpaid is on the road, not stuck at step 4.
  if (trip.stage === 'OPEN') {
    if (trip.advancePaidPaise > 0) return 'ADVANCE_PAID';
    if (advanceDocsUploaded(trip)) return 'ADVANCE_DOCS_UPLOADED';
    // Step 3 is conditional — FLOWS.md §6 marks the lorry receipt "if needed".
    return trip.lrCode ? 'LR_ISSUED' : 'TRIP_GENERATED';
  }
  if (trip.stage === 'IN_TRANSIT') return 'TRACKING';
  // Forfeiture first — see `order-ladder.ts`. A closing line that caught
  // "everything else" is what let a forfeited order read as POD_VERIFIED.
  if (trip.podStatus === 'FORFEITED') return 'POD_FORFEITED';
  if (trip.podStatus === 'PENDING') return 'UNLOADED';
  // A rejected proof has to be sent again, so it goes back to waiting.
  if (trip.podStatus === 'REJECTED') return 'UNLOADED';
  if (trip.podStatus === 'ATTACHED' || trip.podStatus === 'RECEIVED') return 'POD_UPLOADED';
  if (trip.podStatus === 'VERIFIED' || trip.podStatus === 'APPROVED') {
    return trip.balancePaidPaise > 0 ? 'BALANCE_RELEASED' : 'POD_VERIFIED';
  }
  // No closing "everything else". The API's ladder makes this a build error
  // via an exhaustive switch; this side can only fail loudly at runtime, but
  // that still beats silently calling an unknown status "proof checked" —
  // which is exactly how FORFEITED went unnoticed.
  throw new Error(`orderLadder: unhandled pod_status ${JSON.stringify(trip.podStatus)}`);
}

/** An order's comments, oldest first — the shape `OrdersRepository.comments` returns. */
function orderCommentsFor(orderId: string) {
  return db.orderComments
    .filter((c: any) => c.orderId === orderId)
    .sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)))
    .map((c: any) => ({ id: c.id, body: c.body, at: c.at, authorName: c.authorName }));
}

/** There is no order id of its own: an order carries its indent's id. */
function orderNoFor(indent: any): string {
  return indent.code;
}

function orderRow(indent: any) {
  const trip = db.trips.find((t: any) => t.indentCode === indent.code) ?? null;
  const invoice = trip
    ? (db.invoices.find((inv: any) => (inv.tripIds ?? []).includes(trip.id)) ?? null)
    : null;
  const status = orderLadder(indent, trip);
  return {
    id: indent.id,
    orderNo: orderNoFor(indent),
    indentId: indent.id,
    indentCode: indent.code,
    clientName: indent.clientName,
    lane: `${indent.fromCity} → ${indent.toCity}`,
    fromCity: indent.fromCity,
    toCity: indent.toCity,
    vendorName: trip?.vendorName ?? null,
    vehicleNo: trip?.vehicleNo ?? null,
    pickupDate: indent.pickupDate,
    sellRatePaise: indent.sellRatePaise,
    branchName: indent.branchName,
    status,
    stepNo: orderStepNo(status),
    tripId: trip?.id ?? null,
    tripCode: trip?.code ?? null,
    invoiceId: invoice?.id ?? null,
    invoiceCode: invoice?.code ?? null,
    failureCause: indent.failureCause ?? null,
    closedAt:
      status === 'BALANCE_RELEASED' || status === 'POD_FORFEITED' ? (trip?.deliveredAt ?? null) : null,
  };
}

/**
 * The Payments section of an order, mirroring `buildOrderPayments` in
 * internal-api's `order-payments.ts` (a drift test runs the same scenarios
 * through both).
 *
 * Trips seeded as already paid have no row in `db.payments` — the ledger only
 * fills as money is released in this session — so a paid trip without one gets
 * a stand-in transfer reference derived from its code. It is fixture data like
 * everything else here; the real endpoint reads the recorded UTR.
 */
export function orderPaymentsFor(indent: any, trip: any, role: RoleCode, scope: string | null) {
  const grants: string[] = SEED_GRANTS[role] ?? [];
  const canSeeMargin =
    grants.includes('pnl.view_all') ||
    (grants.includes('pnl.view_own') && !!scope && scopedBranch(scope)?.name === indent.branchName);

  const charges: any[] = trip?.charges ?? [];
  let loadingPaise = 0;
  let unloadingPaise = 0;
  let otherChargesPaise = 0;
  for (const c of charges) {
    if (c.chargeType === 'LOADING') loadingPaise += c.costAmountPaise;
    else if (c.chargeType === 'UNLOADING') unloadingPaise += c.costAmountPaise;
    else otherChargesPaise += c.costAmountPaise;
  }

  const sourcingRatePaise: number | null = indent.buyRatePaise ?? null;
  const placementRatePaise: number = indent.sellRatePaise;
  const marginPaise =
    canSeeMargin && sourcingRatePaise !== null
      ? placementRatePaise - sourcingRatePaise - loadingPaise - unloadingPaise - otherChargesPaise
      : null;
  const marginPct =
    marginPaise !== null && placementRatePaise > 0 ? Math.round((marginPaise / placementRatePaise) * 1000) / 10 : null;

  const line = (kind: 'ADVANCE' | 'BALANCE', paidPaise: number) => {
    if (!trip) return null;
    const recorded = db.payments
      .filter((p: any) => p.tripId === trip.id && p.kind === kind)
      .sort((a: any, b: any) => String(b.releasedAt).localeCompare(String(a.releasedAt)))[0];
    if (recorded) {
      return {
        grossPaise: recorded.grossPaise,
        penaltyPaise: recorded.penaltyPaise ?? 0,
        deductionPaise: recorded.deductionPaise ?? 0,
        netPaise: recorded.netPaise,
        mode: recorded.mode,
        utr: recorded.utr,
        valueDate: recorded.valueDate,
        releasedAt: recorded.releasedAt,
        releasedByName: recorded.releasedBy ?? null,
      };
    }
    if (paidPaise <= 0) return null;
    return {
      grossPaise: paidPaise,
      penaltyPaise: 0,
      deductionPaise: 0,
      netPaise: paidPaise,
      mode: 'NEFT',
      utr: `${kind === 'ADVANCE' ? 'HDFCN' : 'HDFCB'}${String(trip.code).replace(/\D/g, '').padStart(8, '0')}`,
      valueDate: trip.deliveredAt?.slice(0, 10) ?? indent.pickupDate,
      releasedAt: trip.deliveredAt ?? indent.pickupDate,
      releasedByName: null,
    };
  };

  return {
    sourcingRatePaise,
    placementRatePaise,
    loadingPaise,
    unloadingPaise,
    otherChargesPaise,
    marginPaise,
    marginPct,
    advance: line('ADVANCE', trip?.advancePaidPaise ?? 0),
    balance: line('BALANCE', trip?.balancePaidPaise ?? 0),
  };
}

/**
 * The orders search, mirroring `OrdersRepository.applyFilters`.
 *
 * `skipStatus` is for the tab counts: each tab reports how many orders would
 * sit in it under the current search, so the step itself is left out.
 * Vehicle numbers compare with spaces and dashes removed, as the API does.
 */
function searchOrders(query: URLSearchParams, branch: string | null, skipStatus = false) {
  const text = (key: string) => (query.get(key) ?? '').trim().toLowerCase();
  const squash = (v: unknown) => String(v ?? '').toLowerCase().replace(/[\s-]+/g, '');
  const has = (hay: unknown, needle: string) => String(hay ?? '').toLowerCase().includes(needle);
  const statuses = skipStatus ? [] : (query.get('status') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const client = query.get('client');
  const openOnly = query.get('open') === '1' || query.get('open') === 'true';
  const [q, clientName, vendor, from, to, branchName] = ['q', 'clientName', 'vendor', 'from', 'to', 'branchName'].map(text);
  const truck = squash(query.get('truck'));
  const ref = text('ref');

  return scopeBranch(db.indents, branch)
    .map((indent: any) => ({ indent, row: orderRow(indent) }))
    .filter(({ indent, row }) => {
      if (statuses.length && !statuses.includes(row.status)) return false;
      if (client && indent.clientId !== client) return false;
      if (openOnly && row.status === 'BALANCE_RELEASED') return false;
      if (q && ![row.orderNo, row.indentCode, row.tripCode, row.clientName, row.fromCity, row.toCity].some((v) => has(v, q))) return false;
      if (clientName) {
        const c: any = db.clients.find((x: any) => x.id === indent.clientId);
        if (![row.clientName, c?.code, c?.gstin, c?.contact, c?.phone].some((v) => has(v, clientName))) return false;
      }
      if (vendor && !has(row.vendorName, vendor)) return false;
      if (from && !has(row.fromCity, from)) return false;
      if (to && !has(row.toCity, to)) return false;
      if (branchName && !has(row.branchName, branchName)) return false;
      if (truck && !squash(row.vehicleNo).includes(truck)) return false;
      if (ref) {
        const trip: any = row.tripId ? db.trips.find((t: any) => t.id === row.tripId) : null;
        if (![row.indentCode, row.tripCode, row.invoiceCode, trip?.lrCode].some((v) => has(v, ref))) return false;
      }
      return true;
    })
    .map(({ row }) => row);
}

/**
 * A plausible history for the fixture.
 *
 * The real table appends a row as each step is entered; the fixtures have no
 * event log, so this reconstructs the steps an order must already have passed
 * through to be where it is. Timestamps are spaced backwards from the pickup
 * date so the timeline reads in order — they are illustrative, and the real
 * endpoint returns recorded ones.
 */
function orderEvents(row: any) {
  const upto = row.status === 'FAILED' ? 1 : row.stepNo;
  const base = new Date(row.pickupDate).getTime();
  const events = ORDER_LADDER.slice(0, upto).map((status, i) => ({
    id: `oe-${row.id}-${i}`,
    status,
    stepNo: i + 1,
    actorName: null,
    note: null,
    at: new Date(base + i * 86_400_000).toISOString(),
  }));
  if (row.status === 'FAILED') {
    events.push({
      id: `oe-${row.id}-failed`,
      status: 'FAILED' as never,
      stepNo: 1,
      actorName: null,
      note: row.failureCause,
      at: new Date(base + 86_400_000).toISOString(),
    });
  }
  return events;
}

/* ---- client onboarding --------------------------------------------------
   Mirrors `client-onboarding.ts` in internal-api. Same required-document
   rule, same three unmet states, so `BlockedPanel` renders the fixture's
   answer and the real one identically. */

const CLIENT_DOCUMENT_LABEL: Record<string, string> = {
  GST_CERTIFICATE: 'GST certificate',
  PAN: 'PAN card',
  SIGNED_AGREEMENT: 'Signed rate agreement',
  CREDIT_CHECK: 'Credit and credibility check',
};

/** A spot client has no rate contract to sign, so it is not asked for one. */
function requiredClientDocs(engagement: string): string[] {
  const always = ['GST_CERTIFICATE', 'PAN', 'CREDIT_CHECK'];
  return engagement === 'CONTRACT' ? [...always, 'SIGNED_AGREEMENT'] : always;
}

function clientOnboardingGate(client: any) {
  const docs: any[] = client.documents ?? [];
  const unmet: { key: string; label: string; state: string }[] = [];
  const cleared: { key: string; label: string }[] = [];

  for (const kind of requiredClientDocs(client.engagement)) {
    const label = CLIENT_DOCUMENT_LABEL[kind] ?? kind;
    const doc = docs.find((d) => d.kind === kind);
    if (!doc) unmet.push({ key: kind, label: `${label} not uploaded`, state: 'MISSING' });
    else if (doc.status === 'VERIFIED') cleared.push({ key: kind, label });
    else if (doc.status === 'REJECTED')
      unmet.push({ key: kind, label: `${label} rejected — a new one is needed`, state: 'REJECTED' });
    else unmet.push({ key: kind, label: `${label} uploaded but not checked`, state: 'UNVERIFIED' });
  }

  return { unmet, cleared, canActivate: unmet.length === 0 };
}

/* ---- tickets -------------------------------------------------------------
   Mirrors `ticket-rules.ts` in internal-api: the same refusals, in the same
   order, with the same wording. `ticket-rules-drift.test.ts` holds the two
   together. */

const MIN_TICKET_DETAIL = 20;

export function ticketTransitionRefusal(
  from: string,
  to: string | undefined,
  resolution: string | null | undefined,
): { code: string; message: string } | null {
  if (!to || to === from) return null;

  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'].includes(to)) {
    return { code: 'NOT_A_STATUS', message: `${to} is not a ticket status.` };
  }

  const closed = (s: string) => s === 'RESOLVED' || s === 'WONT_FIX';

  if (closed(from) && closed(to)) {
    return {
      code: 'ALREADY_CLOSED',
      message: 'This ticket is already closed. Reopen it first if there is more to do.',
    };
  }

  if (closed(to)) {
    const note = (resolution ?? '').trim();
    if (note.length === 0) {
      return {
        code: 'RESOLUTION_REQUIRED',
        message: 'Say what was done about it. The person who reported it reads this.',
      };
    }
    if (note.length < MIN_TICKET_DETAIL) {
      return {
        code: 'RESOLUTION_TOO_SHORT',
        message: `Say what was done in at least ${MIN_TICKET_DETAIL} characters — "fixed" is not an answer.`,
      };
    }
  }

  return null;
}

/* ---- audit trail ---------------------------------------------------------
   Mirrors `audit-labels.ts` in internal-api: the same verbs, the same nouns,
   the same de-slugged fallback for an action neither side has a word for yet.
   `audit-labels-drift.test.ts` holds the two together. */

const AUDIT_ACTION_VERB: Record<string, string> = {
  CREATE: 'created',
  UPDATE: 'changed',
  DELETE: 'removed',
  STATUS_CHANGE: 'changed the status of',
  APPROVAL_RAISED: 'asked for approval on',
  APPROVAL_APPROVED: 'approved',
  APPROVAL_REJECTED: 'turned down',
  PAYMENT_RELEASED: 'released payment for',
  DOCUMENT_VERIFIED: 'verified a document on',
  DOCUMENT_REJECTED: 'rejected a document on',
  RATE_REVISION_APPLIED: 'changed the agreed rate on',
  RATE_LANE_ADDED: 'added an agreed rate to',
  LANE_BAND_SET: 'set the bid band on',
  LANE_BAND_CHANGED: 'changed the bid band on',
  VENDOR_ACTIVATED: 'cleared for work',
  CLIENT_ACTIVATED: 'cleared for work',
};

const AUDIT_ENTITY_NOUN: Record<string, string> = {
  vendors: 'transporter',
  vendor_documents: 'transporter’s papers',
  clients: 'client',
  client_documents: 'client’s papers',
  indents: 'load request',
  trips: 'trip',
  trip_documents: 'trip papers',
  rate_card_lanes: 'agreed rate',
  payments: 'payment',
  invoices: 'invoice',
  receipts: 'receipt',
  approvals: 'approval',
  pod_receipts: 'delivery proof',
  quotes: 'quote',
  rfqs: 'rate request',
  users: 'person',
  roles: 'role',
  config: 'setting',
  notifications: 'notification',
};

const deslugAudit = (code: string) => code.toLowerCase().replace(/_/g, ' ');

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_VERB[action] ?? deslugAudit(action);
}

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_NOUN[entityType] ?? deslugAudit(entityType);
}

/**
 * Which fields moved. Only keys present in `after` count — a partial update
 * writes only what it touched, and diffing over the union would report a dozen
 * phantom removals on every row.
 */
export function auditChangedFields(before: unknown, after: unknown) {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return [];
  const b = (before && typeof before === 'object' && !Array.isArray(before) ? before : {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]))
    .map((key) => ({ field: key, from: b[key] ?? null, to: a[key] }));
}

export function auditDescribe(row: {
  actorName: string | null;
  actorRole: string;
  action: string;
  entityType: string;
}): string {
  const who = row.actorName ?? `Somebody with the ${row.actorRole} role`;
  return `${who} ${auditActionLabel(row.action)} a ${auditEntityLabel(row.entityType)}`;
}

function auditEventDto(e: any) {
  return {
    id: e.id,
    at: e.at,
    actorId: e.actorId ?? null,
    actorName: e.actorName ?? null,
    actorRole: e.actorRole,
    byVendor: (e.actorVendorId ?? null) !== null,
    action: e.action,
    actionLabel: auditActionLabel(e.action),
    entityType: e.entityType,
    entityLabel: auditEntityLabel(e.entityType),
    entityId: e.entityId ?? null,
    summary: auditDescribe(e),
    changed: auditChangedFields(e.before, e.after),
    before: e.before ?? null,
    after: e.after ?? null,
  };
}

/* ---- client rate revision ------------------------------------------------
   Mirrors `rate-revision.ts` in internal-api: the same five refusals, checked
   in the same order, with the same wording. Exported so
   `rate-revision-drift.test.ts` can hold it against the real one — the fixture
   being the more permissive side is how a screen ends up demonstrating a state
   the product refuses. */

/** Same floor as the approvals engine's REASON_TOO_SHORT (>= 20, trimmed). */
const MIN_REVISION_REASON = 20;

export function rateRevisionRefusal(
  lane: { ratePaise: number; validFrom: string; validTo: string | null },
  input: { newRatePaise: number; effectiveFrom: string; reason: string },
  now: Date = new Date(),
): { code: string; message: string } | null {
  if (input.newRatePaise === lane.ratePaise) {
    return { code: 'SAME_RATE', message: 'That is the rate already in force — nothing would change.' };
  }

  if (!input.reason || input.reason.trim().length < MIN_REVISION_REASON) {
    return {
      code: 'REASON_TOO_SHORT',
      message: 'Say why the rate is changing. It is what a billing dispute is argued from later.',
    };
  }

  const effective = Date.parse(input.effectiveFrom);
  if (Number.isNaN(effective)) {
    return { code: 'EFFECTIVE_IN_PAST', message: 'That is not a date.' };
  }

  if (effective <= Date.parse(lane.validFrom)) {
    return {
      code: 'EFFECTIVE_BEFORE_START',
      message: `The new rate has to start after the current one did (${lane.validFrom}).`,
    };
  }

  // Backdating is refused outright: it would silently re-price loads already
  // raised, and already invoiced. A retrospective correction belongs in a
  // credit note against the invoice, where somebody can see it.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (effective < startOfToday) {
    return {
      code: 'EFFECTIVE_IN_PAST',
      message:
        'A rate cannot start in the past — it would re-price loads already raised. Raise a credit note against the invoice instead.',
    };
  }

  if (lane.validTo && Date.parse(lane.validTo) < startOfToday) {
    return {
      code: 'LANE_ALREADY_CLOSED',
      message: `That agreed rate ended on ${lane.validTo}. Award a new lane rather than revising a closed one.`,
    };
  }

  return null;
}

/**
 * The lanes actually in force for a client today.
 *
 * A revised rate leaves two rows for one route — the closed original and its
 * successor — so anything counting or displaying "the rate card" has to mean
 * the current one. History is still there; it just is not the answer to "what
 * do we charge them".
 */
function lanesInForce(clientId: string, on: string = new Date().toISOString().slice(0, 10)): any[] {
  return (db.rateCards[clientId] ?? []).filter(
    (l: any) => l.validFrom <= on && (!l.validTo || l.validTo >= on),
  );
}

/**
 * Why a lane cannot be added, or null. Mirrors `checkNewLane` in internal-api's
 * `rate-lane.ts`: the same route and truck type may not be covered twice over
 * the same days (inclusive; a null end is open-ended).
 */
function laneClash(
  clientId: string,
  lane: { origin: string; destination: string; truckType: string; validFrom: string; validTo: string | null },
): string | null {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const clash = (db.rateCards[clientId] ?? []).some(
    (l: any) =>
      same(l.origin, lane.origin) &&
      same(l.destination, lane.destination) &&
      same(l.truckType, lane.truckType) &&
      (lane.validTo === null || l.validFrom <= lane.validTo) &&
      (l.validTo === null || l.validTo === undefined || lane.validFrom <= l.validTo),
  );
  return clash
    ? 'This client already has an agreed rate for that route and truck type over those dates. Change it under Rate revision instead of adding it twice.'
    : null;
}

/** Matches internal-api's `rupees()` — same grouping, same symbol. */
function rupeesOf(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function clientOnboardingDetail(client: any) {
  const gate = clientOnboardingGate(client);
  return {
    id: client.id,
    code: client.code,
    name: client.name,
    billingCity: client.billingCity,
    gstin: client.gstin ?? null,
    engagement: client.engagement,
    status: client.status,
    rejectionReason: client.rejectionReason ?? null,
    // Built from what is required, not from what happens to be uploaded — a
    // checklist has to show the gaps.
    documents: requiredClientDocs(client.engagement).map((kind) => {
      const d = (client.documents ?? []).find((x: any) => x.kind === kind);
      return {
        kind,
        label: CLIENT_DOCUMENT_LABEL[kind] ?? kind,
        status: d?.status ?? 'MISSING',
        reference: d?.reference ?? null,
        attachmentId: d?.attachmentId ?? null,
        validFrom: d?.validFrom ?? null,
        validTo: d?.validTo ?? null,
        rejectReason: d?.rejectReason ?? null,
        verifiedAt: d?.verifiedAt ?? null,
        verifiedByName: d?.verifiedByName ?? null,
      };
    }),
    gate,
  };
}

/* ---- routes ------------------------------------------------------------- */

const routes: [string, RegExp, Handler][] = [
  /* --------------------------------------------------- allowed emails --- */
  [
    'GET',
    /^\/admin\/users$/,
    ({ role }) => {
      if (!SEED_GRANTS[role]?.includes('config.manage')) fail(403, 'FORBIDDEN', 'Only administrators manage sign-in access.');
      return ok(ACCOUNTS.map(allowedEmailView).reverse());
    },
  ],
  [
    'POST',
    /^\/admin\/users$/,
    ({ role, body }) => {
      if (!SEED_GRANTS[role]?.includes('config.manage')) fail(403, 'FORBIDDEN', 'Only administrators manage sign-in access.');
      const email = String(body?.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'VALIDATION_FAILED', 'Enter a valid email address.');
      if (CREDENTIALS[email]) {
        fail(
          409,
          'EMAIL_ALREADY_ALLOWED',
          DISABLED_EMAILS.has(email)
            ? 'This email is already on the list but switched off. Switch it back on instead.'
            : 'This email is already allowed to sign in.',
        );
      }
      const branch = body?.branchId ? BRANCHES.find((b) => b.id === body.branchId) : null;
      const account: FixtureAccount = {
        userId: `u-${Date.now().toString(36)}`,
        name: String(body?.name ?? '').trim() || email.split('@')[0],
        email,
        role: body.role as RoleCode,
        branch: branch?.code ?? null,
      };
      ACCOUNTS.push(account);
      CREDENTIALS[email] = account;
      ALLOWED_AT[account.userId] = new Date().toISOString();
      rememberPeople();
      return status(201, allowedEmailView(account));
    },
  ],
  [
    'PATCH',
    /^\/admin\/users\/([^/]+)$/,
    ({ role, params, body, headers }) => {
      if (!SEED_GRANTS[role]?.includes('config.manage')) fail(403, 'FORBIDDEN', 'Only administrators manage sign-in access.');
      const account = ACCOUNTS.find((a) => a.userId === params[0]) ?? fail(404, 'NOT_FOUND', 'No such person on the list.');
      const authHeader = String(headers['authorization'] ?? '');
      const me = readToken(authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null, 'access');
      if (me.ok && me.claims.sub === account.userId && (body?.status === 'DISABLED' || (body?.role && body.role !== 'ADMIN'))) {
        fail(409, 'SELF_LOCKOUT', 'You cannot switch off or change your own access. Ask another administrator.');
      }
      if (body?.role) account.role = body.role;
      if (typeof body?.name === 'string' && body.name.trim()) account.name = body.name.trim();
      if (body?.branchId !== undefined) {
        account.branch = body.branchId ? (BRANCHES.find((b) => b.id === body.branchId)?.code ?? null) : null;
      }
      if (body?.status === 'DISABLED') DISABLED_EMAILS.add(account.email.toLowerCase());
      if (body?.status === 'ACTIVE') DISABLED_EMAILS.delete(account.email.toLowerCase());
      rememberPeople();
      return ok(allowedEmailView(account));
    },
  ],
  /* ---------------------------------------------------------- session --- */
  [
    'GET',
    /^\/auth\/session$/,
    ({ headers }) => {
      // The real backend's SupabaseJwtGuard rejects a missing or unrecognised
      // bearer token outright — `currentRole()`'s OPS fallback exists for
      // every *other* route (reached only once a session already resolved),
      // not this one. Reusing that fallback here made the session gate
      // fail-open: any visitor, signed in or not, was silently admitted as
      // OPS, so the sign-in redirect never actually triggered and an
      // unreadable token quietly became an OPS session instead of a failure.
      const authHeader = String(headers['authorization'] ?? '');
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const result = readToken(token, 'access');
      // An expired access token is its own answer, not a generic rejection:
      // `apis.ts` refreshes and retries once on this, and only sends someone
      // back to the sign-in screen if that also fails.
      if (!result.ok && result.reason === 'EXPIRED')
        fail(401, 'TOKEN_EXPIRED', 'This session has expired.');
      const role = result.ok
        ? result.claims.role
        : fail(401, 'UNAUTHORIZED', 'Missing or invalid bearer token.');
      // Resolved by `sub`, not by role. `USERS[role]` answers with the role's
      // default person, so a session for the *second* Operations account
      // would have come back wearing the first one's name, id and — the part
      // that actually changes behaviour — their empty branch.
      const claims = result.ok ? result.claims : null;
      const user = ACCOUNTS.find((a) => a.userId === claims?.sub) ?? USERS[role];
      return ok({
        userId: user.userId,
        name: user.name,
        email: user.email,
        role,
        permissions: SEED_GRANTS[role],
        // From the token's claim, mirroring `auth.service.ts`, which returns
        // `branch: user.branch` unconditionally now rather than nulling it
        // for every role but one.
        branch: scopedBranch(claims?.branch ?? user.branch),
      });
    },
  ],
  ['GET', /^\/branches$/, () => ok(BRANCHES)],
  [
    'POST',
    /^\/branches$/,
    ({ body }) => {
      if (!body?.name || !String(body.name).trim())
        fail(400, 'VALIDATION', 'Branch name is required.');
      const name = String(body.name).trim();
      const code =
        (body.code ? String(body.code) : name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase() ||
        `BR${BRANCHES.length + 1}`;
      const supplySource = body.supplySource ? String(body.supplySource) : null;
      const branch = {
        id: `br-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || BRANCHES.length + 1}`,
        code,
        name,
        city: body.city ? String(body.city).trim() : name,
        catchmentKm: Number(body.catchmentKm) || 150,
        supplySource,
        supplySourceLabel: supplySource ? (SUPPLY_SOURCE_LABEL[supplySource] ?? null) : null,
        supplyRemarks: body.supplyRemarks ? String(body.supplyRemarks) : null,
      };
      BRANCHES.push(branch);
      return ok(branch);
    },
  ],
  [
    'PATCH',
    /^\/branches\/([^/]+)$/,
    ({ body, params }) => {
      const branch =
        BRANCHES.find((b) => b.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Branch not found.');
      if (body?.supplySource !== undefined) {
        const next = body.supplySource ? String(body.supplySource) : null;
        branch.supplySource = next;
        branch.supplySourceLabel = next ? (SUPPLY_SOURCE_LABEL[next] ?? null) : null;
      }
      if (body?.supplyRemarks !== undefined) {
        branch.supplyRemarks = body.supplyRemarks ? String(body.supplyRemarks) : null;
      }
      return ok(branch);
    },
  ],
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
      // The real handler replays the action inside the same transaction; this
      // is the one kind the fixture executes, so the demo shows the new limits
      // actually landing on the lane rather than an approval that changes nothing.
      const bandChange = (approval as any).action as
        | { clientId: string; laneId: string; bidMinPaise: number; bidMaxPaise: number }
        | undefined;
      if (approval.kind === 'LANE_BAND_CHANGE' && bandChange) {
        const lane = (db.rateCards[bandChange.clientId] ?? []).find((l: any) => l.id === bandChange.laneId);
        if (lane) {
          lane.bidMinPaise = bandChange.bidMinPaise;
          lane.bidMaxPaise = bandChange.bidMaxPaise;
        }
      }
      // A lane added outside an RFQ lands on the rate card only now, when the
      // second signature is given — a proposal changes nothing anybody is billed
      // against. Re-checked as the real handler does, because the approval may
      // have sat in the inbox while another lane took the same route.
      const newLane = (approval as any).action as
        | {
            clientId: string;
            origin: string;
            destination: string;
            truckType: string;
            ratePaise: number;
            transitDays: number;
            validFrom: string;
            validTo: string | null;
            transitPenaltyApplies?: boolean;
            transitPenaltyPerDayPaise?: number;
            approvalMailSubject?: string;
          }
        | undefined;
      if (approval.kind === 'RATE_CARD_LANE' && newLane) {
        const clash = laneClash(newLane.clientId, newLane);
        if (clash) fail(409, 'RATE_LANE_NO_LONGER_VALID', `${clash} Raise a fresh proposal if it is still wanted.`);
        (db.rateCards[newLane.clientId] ??= []).push({
          id: `rc-${Date.now()}`,
          rfqLaneId: `DIRECT/${newLane.clientId}`,
          origin: newLane.origin,
          destination: newLane.destination,
          truckType: newLane.truckType,
          ratePaise: newLane.ratePaise,
          rateBasis: (newLane as any).rateBasis ?? 'FTL',
          transitDays: newLane.transitDays,
          reportingRule: null,
          validFrom: newLane.validFrom,
          validTo: newLane.validTo,
          supplySource: null,
          supplySourceLabel: null,
          supplyRemarks: null,
          bidMinPaise: null,
          bidMaxPaise: null,
          transitPenaltyApplies: !!newLane.transitPenaltyApplies,
          transitPenaltyPerDayPaise: newLane.transitPenaltyApplies ? (newLane.transitPenaltyPerDayPaise ?? 0) : 0,
          approvalMailSubject: newLane.approvalMailSubject ?? null,
        });
      }
      const award = (approval as any).action as { indentId: string; quoteId: string } | undefined;
      if (approval.kind === 'ABOVE_BAND_PRICE' && award) {
        const indent = db.indents.find((i: any) => i.id === award.indentId);
        const quote = indent?.quotes.find((q: any) => q.id === award.quoteId);
        if (indent && quote && indent.stage === 'OPEN' && quote.status === 'SUBMITTED') applyMockAward(indent, quote);
      }
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
    ({ body }) => {
      /*
       * Reject an upload with no file, exactly as the real endpoint does.
       *
       * This handler used to be `() => ok({...})` — it ignored the body
       * entirely and accepted anything. That is why a file-less upload
       * survived for months in two places: the console POSTed JSON with no
       * file part, the fixture said yes, and the bug could only ever appear
       * against the real multipart API. A fixture that is more permissive
       * than the thing it mirrors is worse than no fixture, because it
       * converts a development-time failure into a production one.
       */
      const hasFile =
        typeof FormData !== 'undefined' && body instanceof FormData
          ? body.get('file') instanceof Blob
          : Boolean(body?.file);

      if (!hasFile) {
        fail(
          400,
          'FILE_REQUIRED',
          'POST /attachments is multipart/form-data and needs a `file` part. Send a FormData with the chosen file, not a JSON body.',
        );
      }

      const file: any =
        typeof FormData !== 'undefined' && body instanceof FormData ? body.get('file') : body.file;

      // Kept so the document can be shown again — see `files.ts`.
      const id = `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (typeof Blob !== 'undefined' && file instanceof Blob) {
        const blob = file as Blob & { name?: string };
        return keepFile(id, blob).then(() =>
          ok({
            id,
            filename: blob.name ?? 'upload.bin',
            contentType: file?.type ?? 'application/octet-stream',
            bytes: file?.size ?? 0,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb924',
            uploadedAt: helpers.now(),
          }),
        );
      }

      return ok({
        id,
        filename: file?.name ?? 'upload.bin',
        contentType: file?.type ?? 'application/octet-stream',
        bytes: file?.size ?? 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb924',
        uploadedAt: helpers.now(),
      });
    },
  ],
  [
    'GET',
    /^\/attachments\/([^/]+)\/url$/,
    ({ params }) => {
      const file = fileFor(params[0]);
      return ok({ url: file.url, mime: file.mime, expiresAt: new Date(Date.now() + 900_000).toISOString() });
    },
  ],

  /* ------------------------------------------------------------- C2 ----- */
  [
    'GET',
    /^\/vendors\/leads$/,
    // The three `converted*` fields are always present (null until the lead
    // becomes a transporter), same as `LeadsRepository.list()`'s join.
    () =>
      ok(
        db.leads.map((l) => ({
          convertedVendorId: null,
          convertedVendorCode: null,
          convertedVendorName: null,
          ...l,
        })),
      ),
  ],
  [
    'POST',
    /^\/vendors\/leads$/,
    ({ body }) => {
      const lead = {
        id: `l-${db.leads.length + 1}`,
        code: nextNumber('LEAD'),
        stage: 'NEW',
        convertedVendorId: null,
        convertedVendorCode: null,
        convertedVendorName: null,
        ...body,
      };
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
    ({ role, branch }) =>
      ok(
        scopeBranch(db.marketGap, branch).map((g) => ({
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
      for (const key of ['target', 'onPanel', 'converted'] as const) {
        if (body?.[key] === undefined) continue;
        if (!Number.isInteger(body[key]) || body[key] < 0) fail(400, 'VALIDATION_ERROR', `${key} must be a whole number, 0 or more.`);
        row[key] = body[key];
      }
      // Same computed shape the list hands out — the real API answers a write
      // with the full row, and the screen swaps it in for the one it has.
      return ok({
        ...row,
        gap: Math.max(0, row.target - row.onPanel),
        progressPct: row.target ? Math.round((row.converted / row.target) * 100) : 0,
      });
    },
  ],
  [
    'POST',
    /^\/vendors\/market-gap$/,
    ({ body, branch }) => {
      const b = BRANCHES.find((x) => x.id === body?.branchId) ?? fail(400, 'VALIDATION_ERROR', 'Choose a branch.');
      if (branch && b.code !== branch) fail(403, 'WRONG_BRANCH', 'You can only record a gap for your own branch.');
      const lane = String(body?.lane ?? '').trim();
      const truckType = String(body?.truckType ?? '').trim();
      if (lane.length < 3) fail(400, 'VALIDATION_ERROR', 'Enter the lane, e.g. Nashik → Kolkata.');
      if (truckType.length < 2) fail(400, 'VALIDATION_ERROR', 'Enter the truck type.');
      const counts = ['target', 'onPanel', 'converted'].map((k) => body?.[k] ?? 0);
      if (counts.some((n) => !Number.isInteger(n) || n < 0)) fail(400, 'VALIDATION_ERROR', 'Counts must be whole numbers, 0 or more.');
      if (
        db.marketGap.some(
          (g) => g.branchId === b.id && g.lane.toLowerCase() === lane.toLowerCase() && g.truckType.toLowerCase() === truckType.toLowerCase(),
        )
      )
        fail(409, 'MARKET_GAP_EXISTS', `${lane} · ${truckType} is already on the list for this branch — change its numbers there.`);
      const row = {
        id: `mg-${Date.now()}`,
        branchId: b.id,
        branchName: b.name,
        lane,
        truckType,
        target: counts[0],
        onPanel: counts[1],
        converted: counts[2],
      };
      db.marketGap.push(row);
      return ok({
        ...row,
        gap: Math.max(0, row.target - row.onPanel),
        progressPct: row.target ? Math.round((row.converted / row.target) * 100) : 0,
      });
    },
  ],
  ['GET', /^\/vendors\/issues$/, ({ query }) => {
    const s = query.get('status');
    return ok(s ? db.issues.filter((i) => i.status === s) : db.issues);
  }],
  [
    'POST',
    /^\/vendors\/issues$/,
    ({ body, role }) => {
      // `raisedBy` is the actor and `vendorName` is derived from `vendorId`,
      // as `IssuesService.create()` / `IssuesRepository.list()` do — the
      // form does not get to assert either.
      const vendor = body?.vendorId ? db.vendors.find((v) => v.id === body.vendorId || v.code === body.vendorId) : undefined;
      const issue = {
        id: `is-${db.issues.length + 1}`,
        code: nextNumber('ISSUE'),
        status: 'OPEN',
        raisedAt: helpers.now(),
        tripCode: null,
        ...body,
        raisedBy: USERS[role].name,
        vendorName: vendor?.legalName ?? body?.vendorName ?? '—',
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
      // Lead → transporter conversion rides in the same call as the vendor,
      // mirroring `VendorsService.create()`: the lead is looked up first (so
      // a bad `leadId` creates nothing), the vendor takes the lead's source,
      // and the lead is flipped to CONVERTED pointing back at the vendor.
      const { leadId, ...draft } = body ?? {};
      let lead: Record<string, any> | undefined;
      if (leadId) {
        lead = db.leads.find((l) => l.id === leadId) ?? fail(404, 'NOT_FOUND', `Unknown lead: ${leadId}`);
        if (lead.stage === 'CONVERTED' || lead.convertedVendorId)
          fail(409, 'LEAD_ALREADY_CONVERTED', 'This lead has already been converted to a vendor.');
      }
      const vendor = {
        id: `v-${db.vendors.length + 1}`,
        code: nextNumber('VENDOR'),
        status: 'DRAFT',
        kyc: [],
        documents: [],
        advanceHistory: [],
        fleet: [],
        truckTypes: [],
        business: { trips: 0, revenuePaise: 0, marginPaise: 0, advanceOutstandingPaise: 0, balancePendingPaise: 0, penaltiesAccruedPaise: 0, topLanes: [] },
        branchName: BRANCHES.find((b) => b.id === draft.branchId)?.name ?? 'Nashik',
        // Not asked at onboarding — defaulted so the detail page always has a value to render.
        constitution: draft.constitution ?? 'Not specified',
        ...(lead ? { source: lead.source } : {}),
        ...draft,
      };
      db.vendors.unshift(vendor);
      if (lead) {
        lead.stage = 'CONVERTED';
        lead.convertedVendorId = vendor.id;
        lead.convertedVendorCode = vendor.code;
        lead.convertedVendorName = vendor.legalName;
      }
      return ok(vendor);
    },
  ],
  ['GET', /^\/vendors\/([^/]+)$/, ({ params }) => {
    const v = findVendor(params[0]);
    const recoverableBalancePaise = db.sdr
      .filter((r) => r.vendorId === v.id && r.status === 'RESOLVED')
      .reduce((a, r) => a + (r.outstandingPaise ?? 0), 0);
    return ok({ ...v, business: { ...(v.business ?? {}), recoverableBalancePaise } });
  }],
  [
    'GET',
    /^\/vendors\/([^/]+)\/placements$/,
    ({ params }) => {
      const vendor = findVendor(params[0]);
      return ok(
        db.indents
          .filter((i: any) => i.vendorId === vendor.id)
          .map((indent: any) => {
            const order = orderRow(indent);
            const trip = db.trips.find((t: any) => t.indentCode === indent.code) ?? null;
            return {
              indentId: indent.id,
              indentCode: indent.code,
              orderId: order.id,
              orderNo: order.orderNo,
              orderStatus: order.status,
              orderStep: order.stepNo,
              tripId: trip?.id ?? null,
              tripCode: trip?.code ?? null,
              clientName: indent.clientName,
              lane: `${indent.fromCity} → ${indent.toCity}`,
              material: indent.material,
              weightTn: indent.weightTn,
              truckType: indent.truckType,
              pickupDate: indent.pickupDate,
              stage: indent.stage,
              buyRatePaise: indent.buyRatePaise ?? null,
              vehicleNo: indent.vehicleNo ?? null,
              driverName: indent.driverName ?? null,
              driverLicence: indent.driverLicence ?? null,
              placedAt: indent.reportedAt ?? null,
              deliveredAt: trip?.deliveredAt ?? null,
              podStatus: trip?.podStatus ?? null,
              advancePaidPaise: trip?.advancePaidPaise ?? null,
              balancePaidPaise: trip?.balancePaidPaise ?? null,
            };
          })
          .sort((a: any, b: any) => b.pickupDate.localeCompare(a.pickupDate)),
      );
    },
  ],
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
    /^\/vendors\/([^/]+)\/documents\/([^/]+)\/verify$/,
    ({ params, body }) => {
      const vendor = findVendor(params[0]);
      const doc = vendor.documents.find((d: any) => d.kind === params[1] && d.status !== 'MISSING');
      if (!doc) fail(404, 'NOT_FOUND', `${DOC_LABEL[params[1]] ?? params[1]} has not been uploaded for this vendor.`);
      if (body?.approve === false && (!body?.reason || body.reason.trim().length < 20))
        fail(400, 'REASON_TOO_SHORT', 'A reason of at least 20 characters is required.');
      doc.status = body?.approve === false ? 'REJECTED' : 'VERIFIED';
      // Same shape as internal-api's `verifyDocument` — not the vendor.
      return ok({ kind: doc.kind, status: doc.status });
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
      const hasDoc = (kind: string) => vendor.documents.some((d: any) => d.kind === kind && d.status !== 'MISSING');
      const hasKyc = (kind: string) => vendor.kyc.some((k: any) => k.kind === kind && k.status !== 'MISSING');
      if (!hasDoc('TDS_DECLARATION'))
        missing.push({ key: 'TDS_DECLARATION', label: 'TDS declaration not on file', state: 'MISSING' });
      if (!hasDoc('BANK_STATEMENT'))
        missing.push({ key: 'BANK_STATEMENT', label: 'Bank statement or cancelled cheque not on file', state: 'MISSING' });
      if (!['TRADE_LICENCE', 'LABOUR_LICENCE', 'UDYAM'].some(hasDoc))
        missing.push({ key: 'GOVERNMENT_CERTIFICATE', label: 'Government certificate not on file', state: 'MISSING' });
      if (!hasKyc('PAN')) missing.push({ key: 'PAN', label: 'PAN not captured', state: 'MISSING' });
      if (!hasKyc('AADHAAR')) missing.push({ key: 'AADHAAR', label: 'Aadhaar not captured', state: 'MISSING' });
      if (!hasKyc('SELFIE')) missing.push({ key: 'SELFIE', label: 'Geo-stamped selfie not captured', state: 'MISSING' });
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
    'POST',
    /^\/vendors\/([^/]+)\/suspend$/,
    ({ params, body }) => {
      const vendor = findVendor(params[0]);
      if (!body?.reason || body.reason.trim().length < 20)
        fail(400, 'REASON_TOO_SHORT', 'A reason of at least 20 characters is required.');
      if (vendor.status !== 'ACTIVE')
        fail(409, 'VENDOR_NOT_ACTIVE', 'Only an active transporter can be put on hold — this one is not active.');
      vendor.status = 'SUSPENDED';
      return ok({ id: vendor.id, status: vendor.status });
    },
  ],
  [
    'POST',
    /^\/vendors\/([^/]+)\/reinstate$/,
    ({ params }) => {
      const vendor = findVendor(params[0]);
      if (vendor.status !== 'SUSPENDED')
        fail(409, 'VENDOR_NOT_ON_HOLD', 'This transporter is not on hold, so there is nothing to take them off.');
      vendor.status = 'ACTIVE';
      return ok({ id: vendor.id, status: vendor.status });
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
              /*
               * Lanes IN FORCE, not rate rows. Once a rate can be revised, one
               * route has several rows — the closed original and its successor
               * — and counting rows would tell the compliance desk a client has
               * two routes priced when they have one route priced twice.
               */
              note: lanesInForce(c.id).length
                ? `${lanesInForce(c.id).length} lane${lanesInForce(c.id).length === 1 ? '' : 's'} priced`
                : 'No rate card lanes exist for this contract',
              ageDays: 1,
              flag: lanesInForce(c.id).length ? 'Yours to approve' : 'No lanes priced',
              tone: lanesInForce(c.id).length ? 'blue' : 'flag',
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
    // Lanes written before bid limits existed carry no fields for them; the
    // real API answers null for those, so normalise rather than send undefined.
    ({ params }) =>
      ok(
        (db.rateCards[params[0]] ?? []).filter((l: any) => !l.deletedAt).map((l: any) => ({
          ...l,
          rateBasis: l.rateBasis ?? 'FTL',
          bidMinPaise: l.bidMinPaise ?? null,
          bidMaxPaise: l.bidMaxPaise ?? null,
          transitPenaltyApplies: l.transitPenaltyApplies ?? false,
          transitPenaltyPerDayPaise: l.transitPenaltyPerDayPaise ?? 0,
        })),
      ),
  ],
  [
    'GET',
    /^\/clients\/([^/]+)\/rate-card\/pending$/,
    ({ params }) => {
      const client =
        db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ??
        fail(404, 'NOT_FOUND', `Client ${params[0]} not found`);
      return ok(pendingLanesFor(client.id));
    },
  ],
  // Deleting a duplicate rate — Leadership or an administrator only, the same
  // rule as `RateRevisionService.deleteLane` / `deletePendingLane` / `deleteRevision`.
  [
    'DELETE',
    /^\/clients\/([^/]+)\/rate-card\/pending\/([^/]+)$/,
    ({ params, body, role, userId }) => {
      const why = rateDeleteReason(role, body);
      const approval = db.approvals.find(
        (a: any) => a.id === params[1] && a.kind === 'RATE_CARD_LANE' && a.entityId === params[0],
      );
      if (!approval) fail(404, 'NOT_FOUND', `Unknown request: ${params[1]}`);
      if (approval.status !== 'PENDING') fail(409, 'ALREADY_DECIDED', `That request is already ${String(approval.status).toLowerCase()}.`);
      Object.assign(approval, { status: 'REJECTED', note: `Deleted: ${why}`, approverId: userId, decidedAt: helpers.now() });
      return ok({ approvalId: approval.id, deleted: true });
    },
  ],
  [
    'DELETE',
    /^\/clients\/([^/]+)\/rate-card\/([^/]+)$/,
    ({ params, body, role, userId }) => {
      const why = rateDeleteReason(role, body);
      const lane = (db.rateCards[params[0]] ?? []).find((l: any) => l.id === params[1] && !l.deletedAt);
      if (!lane) fail(404, 'NOT_FOUND', 'That rate is not on this client’s rate card.');
      // A change waiting on the lane goes with it — it would otherwise re-create the lane on approval.
      for (const r of db.rateRevisions.filter((x: any) => x.fromLaneId === lane.id && x.status === 'PENDING')) {
        r.status = 'REJECTED';
        const a = db.approvals.find((x: any) => x.action?.revisionId === r.id && x.status === 'PENDING');
        if (a) Object.assign(a, { status: 'REJECTED', note: `Deleted with its lane: ${why}`, approverId: userId, decidedAt: helpers.now() });
      }
      Object.assign(lane, { deletedAt: helpers.now(), deletedBy: userId, deleteReason: why });
      return ok({ laneId: lane.id, deleted: true });
    },
  ],
  [
    'DELETE',
    /^\/clients\/([^/]+)\/rate-revisions\/([^/]+)$/,
    ({ params, body, role, userId }) => {
      const why = rateDeleteReason(role, body);
      const r = db.rateRevisions.find((x: any) => x.id === params[1] && x.clientId === params[0]);
      if (!r) fail(404, 'NOT_FOUND', 'That rate change is not on this client.');
      if (r.status !== 'PENDING') fail(409, 'ALREADY_DECIDED', 'Only a rate change still waiting for sign-off can be deleted.');
      r.status = 'REJECTED';
      const a = db.approvals.find((x: any) => x.action?.revisionId === r.id && x.status === 'PENDING');
      if (a) Object.assign(a, { status: 'REJECTED', note: `Deleted: ${why}`, approverId: userId, decidedAt: helpers.now() });
      return ok({ revisionId: r.id, deleted: true });
    },
  ],
  [
    'POST',
    /^\/clients\/([^/]+)\/rate-card$/,
    ({ params, body, role }) => {
      const client =
        db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ??
        fail(404, 'NOT_FOUND', `Client ${params[0]} not found`);
      if (client.engagement !== 'CONTRACT')
        fail(400, 'CLIENT_IS_SPOT', 'This client is priced load by load, so there is no rate card to add to. Change them to a contract client first.');

      const lane = {
        origin: String(body?.origin ?? '').trim().replace(/\s+/g, ' '),
        destination: String(body?.destination ?? '').trim().replace(/\s+/g, ' '),
        truckType: String(body?.truckType ?? '').trim().replace(/\s+/g, ' '),
        ratePaise: Number(body?.ratePaise),
        rateBasis: body?.rateBasis === 'PMT' ? 'PMT' : 'FTL',
        transitDays: Number(body?.transitDays),
        validFrom: String(body?.validFrom ?? ''),
        validTo: body?.validTo ? String(body.validTo) : null,
      };
      const reason = String(body?.reason ?? '').trim();
      const penalty = {
        transitPenaltyApplies: body?.transitPenaltyApplies === true,
        transitPenaltyPerDayPaise: body?.transitPenaltyApplies === true ? Number(body?.transitPenaltyPerDayPaise) : 0,
        approvalMailSubject: String(body?.approvalMailSubject ?? '').trim(),
      };
      if (penalty.approvalMailSubject.length < 5)
        fail(400, 'VALIDATION_ERROR', 'Put in the subject of the BD and Leadership approval mail.');
      if (penalty.transitPenaltyApplies && !(penalty.transitPenaltyPerDayPaise > 0))
        fail(400, 'VALIDATION_ERROR', 'Enter what a late day costs, or switch the late-delivery penalty off.');
      if (lane.origin.length < 2 || lane.destination.length < 2 || lane.truckType.length < 2)
        fail(400, 'VALIDATION_ERROR', 'Truck type, from and to are all required.');
      if (!Number.isInteger(lane.ratePaise) || lane.ratePaise < 1)
        fail(400, 'VALIDATION_ERROR', 'The lane rate must be above zero.');
      if (!Number.isInteger(lane.transitDays) || lane.transitDays < 0 || lane.transitDays > 60)
        fail(400, 'VALIDATION_ERROR', 'Transit days should be a whole number of days.');
      if (lane.origin.toLowerCase() === lane.destination.toLowerCase())
        fail(400, 'RATE_LANE_SAME_CITY', 'The pickup and drop cities are the same.');
      if (!lane.validFrom || (lane.validTo && lane.validTo < lane.validFrom))
        fail(400, 'RATE_LANE_BAD_DATES', 'The rate cannot end before it starts.');
      if (reason.length < 20)
        fail(400, 'RATE_LANE_REASON_TOO_SHORT', 'Say where this rate was agreed. The person signing it off decides from this.');
      // Already proposed and waiting — see `RateRevisionService.addLane`.
      const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const waiting = pendingLanesFor(client.id).find(
        (p) => same(p.origin, lane.origin) && same(p.destination, lane.destination) && same(p.truckType, lane.truckType),
      );
      if (waiting)
        fail(
          409,
          'RATE_LANE_PENDING',
          `${lane.origin} → ${lane.destination} · ${lane.truckType} is already waiting for approval ` +
            `(proposed by ${waiting.requesterName}). It appears on the rate card once it is approved.`,
        );
      const clash = laneClash(client.id, lane);
      if (clash) fail(400, 'RATE_LANE_LANE_EXISTS', clash);

      return raiseApproval({
        kind: 'RATE_CARD_LANE',
        entityType: 'clients',
        entityId: client.id,
        title: `New agreed rate · ${client.name} · ${lane.origin} → ${lane.destination}`,
        detail:
          `${rupeesOf(lane.ratePaise)} ${lane.rateBasis === 'PMT' ? 'per tonne' : 'per truck'} · ${lane.truckType} · ${lane.transitDays} days · from ${lane.validFrom}` +
          (penalty.transitPenaltyApplies ? ` · late penalty ${rupeesOf(penalty.transitPenaltyPerDayPaise)}/day` : ' · no late penalty') +
          ` · mail: ${penalty.approvalMailSubject}`,
        amountPaise: lane.ratePaise,
        // Same desks as a revision: Compliance and Leadership hold
        // `approve.contract`, neither holds `rate.revise`.
        approverRole: 'COMPLIANCE',
        requiredPermission: 'approve.contract',
        reason,
        role,
        action: { clientId: client.id, ...lane, ...penalty },
      });
    },
  ],
  [
    'PUT',
    /^\/clients\/([^/]+)\/rate-card\/([^/]+)\/band$/,
    ({ params, body, role }) => {
      const client =
        db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ??
        fail(404, 'NOT_FOUND', `Client ${params[0]} not found`);
      const lane =
        (db.rateCards[client.id] ?? []).find((l: any) => l.id === params[1]) ??
        fail(404, 'NOT_FOUND', `Rate card lane ${params[1]} not found on this client`);

      const min = Number(body?.bidMinPaise);
      const max = Number(body?.bidMaxPaise);
      if (!(min >= 1) || !(max >= 1)) fail(400, 'VALIDATION_ERROR', 'Enter both a minimum and a maximum above zero.');
      if (max < min) fail(400, 'VALIDATION_ERROR', 'The bid maximum cannot be below the bid minimum.');

      const hasBand = lane.bidMinPaise != null || lane.bidMaxPaise != null;
      if (!hasBand) {
        lane.bidMinPaise = min;
        lane.bidMaxPaise = max;
        return ok({ applied: true, laneId: lane.id, bidMinPaise: min, bidMaxPaise: max });
      }
      if (lane.bidMinPaise === min && lane.bidMaxPaise === max)
        fail(400, 'BAND_UNCHANGED', 'That is the band already in force — nothing would change.');
      if (!body?.reason || body.reason.trim().length < 20)
        fail(400, 'REASON_TOO_SHORT', 'Say why the band is changing (at least 20 characters). Leadership decides it from this.');

      return raiseApproval({
        kind: 'LANE_BAND_CHANGE',
        entityType: 'clients',
        entityId: client.id,
        title: `Bid band change · ${client.name} · ${lane.origin} → ${lane.destination}`,
        detail: `${rupeesOf(lane.bidMinPaise ?? 0)}–${rupeesOf(lane.bidMaxPaise ?? 0)} → ${rupeesOf(min)}–${rupeesOf(max)} (${lane.truckType})`,
        amountPaise: null,
        approverRole: 'LEADERSHIP',
        requiredPermission: 'approve.above_band',
        reason: body.reason,
        role,
        action: { clientId: client.id, laneId: lane.id, bidMinPaise: min, bidMaxPaise: max },
      });
    },
  ],

  /* -------------------------------------------------------- tickets --- */
  /*
   * Mirrors the tickets module in internal-api — same scoping, same refusals.
   *
   * The scoping is the part worth mirroring faithfully: a caller without
   * `ticket.resolve` sees only what they raised. The fixture cannot read a
   * token (see the auth block), so it answers from `currentRole()` the same
   * way every other handler here does, and ADMIN is the role that resolves.
   */
  [
    'GET',
    /^\/tickets$/,
    ({ query, role }) => {
      const canResolve = SEED_GRANTS[role].includes('ticket.resolve');
      const status = query.get('status');
      const mine = query.get('mine') === '1';

      const visible = db.tickets
        .filter((t: any) => (canResolve && !mine ? true : t.raisedBy === USERS[role].userId))
        .filter((t: any) => !status || t.status === status)
        .sort((a: any, b: any) => {
          // Blocking first, then oldest — the order the work should be done in.
          const rank = (t: any) => (t.severity === 'BLOCKING' ? 0 : 1);
          return rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt));
        });

      const live = visible.filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
      const ages = live.map((t: any) =>
        Math.max(0, Math.floor((Date.now() - Date.parse(t.createdAt)) / 86400000)),
      );

      return ok({
        canResolve,
        scope: canResolve && !mine ? 'ALL' : 'MINE',
        summary: {
          open: visible.filter((t: any) => t.status === 'OPEN').length,
          inProgress: visible.filter((t: any) => t.status === 'IN_PROGRESS').length,
          blocking: live.filter((t: any) => t.severity === 'BLOCKING').length,
          oldestOpenDays: ages.length ? Math.max(...ages) : null,
        },
        rows: visible,
      });
    },
  ],
  [
    'POST',
    /^\/tickets$/,
    ({ body, role }) => {
      if (!body.subject || String(body.subject).trim().length < 5) {
        fail(400, 'VALIDATION_ERROR', 'Give it a short title.');
      }
      if (!body.detail || String(body.detail).trim().length < 20) {
        fail(400, 'VALIDATION_ERROR', 'Say what is wrong in at least 20 characters.');
      }
      if (!body.raisedOnPath) {
        // Captured by the client, never typed. A report without it is
        // unactionable, so the fixture refuses it the way the DTO does.
        fail(400, 'VALIDATION_ERROR', 'A report has to say which screen it came from.');
      }

      const ticket = {
        id: `tkt-${db.tickets.length + 1}-${Date.now()}`,
        code: `TKT-${String(db.tickets.length + 4).padStart(4, '0')}`,
        subject: String(body.subject).trim(),
        detail: String(body.detail).trim(),
        kind: body.kind ?? 'WRONG_DATA',
        severity: body.severity ?? 'NORMAL',
        status: 'OPEN',
        raisedOnPath: body.raisedOnPath,
        entityType: body.entityType ?? null,
        entityId: body.entityId ?? null,
        resolution: null,
        resolvedAt: null,
        resolvedByName: null,
        createdAt: helpers.now(),
        raisedBy: USERS[role].userId,
        raisedByName: USERS[role].name,
        branchName: null,
      };
      db.tickets.unshift(ticket);
      return status(201, ticket);
    },
  ],
  [
    'PATCH',
    /^\/tickets\/([^/]+)$/,
    ({ params, body, role }) => {
      if (!SEED_GRANTS[role].includes('ticket.resolve')) {
        fail(403, 'FORBIDDEN', 'Only Administration can act on a reported problem.');
      }
      const ticket =
        db.tickets.find((t: any) => t.id === params[0] || t.code === params[0]) ??
        fail(404, 'NOT_FOUND', `Ticket ${params[0]} not found`);

      const refusal = ticketTransitionRefusal(ticket.status, body.status, body.resolution);
      if (refusal) fail(400, `TICKET_${refusal.code}`, refusal.message);

      if (body.severity) ticket.severity = body.severity;
      if (body.status && body.status !== ticket.status) {
        ticket.status = body.status;
        if (body.status === 'RESOLVED' || body.status === 'WONT_FIX') {
          ticket.resolution = String(body.resolution).trim();
          ticket.resolvedAt = helpers.now();
          ticket.resolvedByName = USERS[role].name;
        } else {
          // Reopening clears the closure — leaving a named person's sign-off
          // on a ticket that is open again says something untrue about them.
          ticket.resolution = null;
          ticket.resolvedAt = null;
          ticket.resolvedByName = null;
        }
      }
      return ok(ticket);
    },
  ],

  /* ---------------------------------------------------- audit trail --- */
  /*
   * Mirrors `audit-read.service.ts` and `audit-labels.ts` in internal-api —
   * same envelope, same composed `summary`, same `changed` diff. Read-only,
   * and there is deliberately no write route: the real table refuses UPDATE
   * and DELETE at the database, so a fixture that let anything edit an entry
   * would be demonstrating a capability the product does not have.
   */
  [
    'GET',
    /^\/audit\/filters$/,
    () =>
      ok({
        actions: [...new Set(db.auditEvents.map((e: any) => e.action))]
          .sort()
          .map((code) => ({ code, label: auditActionLabel(code as string) })),
        entityTypes: [...new Set(db.auditEvents.map((e: any) => e.entityType))]
          .sort()
          .map((code) => ({ code, label: auditEntityLabel(code as string) })),
      }),
  ],
  [
    'GET',
    /^\/audit$/,
    ({ query }) => {
      const limit = Math.min(Math.max(Number(query.get('limit') ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(query.get('offset') ?? 0) || 0, 0);
      const action = query.get('action');
      const entityType = query.get('entityType');
      const from = query.get('from');
      const to = query.get('to');

      const matched = db.auditEvents
        .filter((e: any) => !action || e.action === action)
        .filter((e: any) => !entityType || e.entityType === entityType)
        .filter((e: any) => !from || e.at >= from)
        // Inclusive of the whole `to` day, matching the API.
        .filter((e: any) => !to || e.at < `${to}T23:59:59.999Z`)
        .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));

      return ok({
        total: matched.length,
        limit,
        offset,
        events: matched.slice(offset, offset + limit).map(auditEventDto),
      });
    },
  ],
  [
    'GET',
    /^\/audit\/([^/]+)\/([^/]+)$/,
    ({ params }) => {
      const matched = db.auditEvents
        .filter((e: any) => e.entityType === params[0] && e.entityId === params[1])
        .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
      return ok({ total: matched.length, limit: 200, offset: 0, events: matched.map(auditEventDto) });
    },
  ],

  /* ------------------------------------------- client rate revision --- */
  /*
   * Mirrors `rate-revision.ts` in internal-api — same refusals, checked in the
   * same order. `rate-revision-drift.test.ts` compares the two across every
   * generated combination, because a fixture that is quietly more permissive
   * than the API it stands in for is how a screen ends up demonstrating a
   * state the product refuses.
   *
   * Unscoped by branch on purpose: an agreed rate is a fact about the client,
   * not about which branch happens to run the load.
   */
  [
    'GET',
    /^\/clients\/([^/]+)\/rate-revisions$/,
    ({ params }) =>
      ok(
        db.rateRevisions
          .filter((r: any) => r.clientId === params[0])
          .map((r: any) => ({
            id: r.id,
            status: r.status,
            oldRatePaise: r.oldRatePaise,
            newRatePaise: r.newRatePaise,
            effectiveFrom: r.effectiveFrom,
            reason: r.reason,
            lane: r.lane,
            truckType: r.truckType,
            requestedByName: r.requestedByName,
            createdAt: r.createdAt,
          }))
          .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))),
      ),
  ],
  [
    'POST',
    /^\/clients\/([^/]+)\/rate-revisions$/,
    ({ params, body, role }) => {
      const clientId = params[0];
      const client =
        db.clients.find((c: any) => c.id === clientId || c.code === clientId) ??
        fail(404, 'NOT_FOUND', `Client ${clientId} not found`);

      const lane =
        (db.rateCards[client.id] ?? []).find((l: any) => l.id === body.laneId) ??
        fail(404, 'NOT_FOUND', `Rate card lane ${body.laneId} not found on this client`);

      if (db.rateRevisions.some((r: any) => r.fromLaneId === lane.id && r.status === 'PENDING')) {
        fail(
          409,
          'REVISION_ALREADY_PENDING',
          'A revision for this lane is already waiting for approval. Decide that one first.',
        );
      }

      const refusal = rateRevisionRefusal(lane, body);
      if (refusal) fail(400, `RATE_REVISION_${refusal.code}`, refusal.message);
      if (String(body?.approvalMailSubject ?? '').trim().length < 5)
        fail(400, 'VALIDATION_ERROR', 'Put in the subject of the BD and Leadership approval mail.');

      db.rateRevisions.unshift({
        id: `rr-${db.rateRevisions.length + 1}-${Date.now()}`,
        clientId: client.id,
        fromLaneId: lane.id,
        toLaneId: null,
        status: 'PENDING',
        oldRatePaise: lane.ratePaise,
        newRatePaise: body.newRatePaise,
        effectiveFrom: body.effectiveFrom,
        reason: body.reason,
        approvalMailSubject: String(body.approvalMailSubject).trim(),
        lane: `${lane.origin} → ${lane.destination}`,
        truckType: lane.truckType,
        requestedByName: `${USERS[role].name} · ${role}`,
        createdAt: helpers.now(),
      });

      return raiseApproval({
        kind: 'RATE_REVISION',
        entityType: 'clients',
        entityId: client.id,
        title: `Rate change · ${client.name} · ${lane.origin} → ${lane.destination}`,
        detail: `${rupeesOf(lane.ratePaise)} → ${rupeesOf(body.newRatePaise)} from ${body.effectiveFrom} (${lane.truckType})`,
        amountPaise: body.newRatePaise,
        // Compliance and Leadership hold `approve.contract`; neither holds
        // `rate.revise`, so nobody signs off their own proposal.
        approverRole: 'COMPLIANCE',
        requiredPermission: 'approve.contract',
        reason: body.reason,
        role,
        action: { revisionId: db.rateRevisions[0].id },
      });
    },
  ],

  /* --------------------------------------------- client onboarding --- */
  /*
   * Declared before `/clients/:id` — the route table matches in order, and a
   * bare `:id` pattern would otherwise treat "onboarding" as a client id.
   */
  [
    'GET',
    /^\/clients\/onboarding$/,
    () =>
      ok(
        db.clients
          .filter((c: any) => ['DRAFT', 'PENDING_VERIFICATION', 'REJECTED'].includes(c.status))
          // Oldest first: a client waiting three weeks for a decision is a
          // worse problem than one who arrived this morning.
          .map((c: any) => {
            const gate = clientOnboardingGate(c);
            return {
              id: c.id,
              code: c.code,
              name: c.name,
              billingCity: c.billingCity,
              engagement: c.engagement,
              status: c.status,
              createdAt: c.createdAt ?? null,
              required: requiredClientDocs(c.engagement).length,
              cleared: gate.cleared.length,
              unmetCount: gate.unmet.length,
              canActivate: gate.canActivate,
            };
          }),
      ),
  ],
  [
    'GET',
    /^\/clients\/([^/]+)\/onboarding$/,
    ({ params }) => ok(clientOnboardingDetail((db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found')))),
  ],
  [
    'POST',
    /^\/clients\/([^/]+)\/onboarding\/documents$/,
    ({ params, body }) => {
      const client = (db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found'));
      if (!requiredClientDocs(client.engagement).includes(body.kind)) {
        fail(
          400,
          'DOCUMENT_NOT_REQUIRED',
          `${CLIENT_DOCUMENT_LABEL[body.kind] ?? body.kind} is not required for a ${String(
            client.engagement,
          ).toLowerCase()} client.`,
        );
      }
      client.documents = client.documents ?? [];
      const existing = client.documents.find((d: any) => d.kind === body.kind);
      // Re-submitting replaces and resets the decision — a fresh paper has
      // not been checked, so it must not inherit the previous VERIFIED.
      const next = {
        kind: body.kind,
        status: 'PENDING',
        reference: body.reference ?? null,
        attachmentId: body.attachmentId ?? null,
        validFrom: body.validFrom ?? null,
        validTo: body.validTo ?? null,
        rejectReason: null,
        verifiedAt: null,
        verifiedByName: null,
      };
      if (existing) Object.assign(existing, next);
      else client.documents.push(next);

      if (client.status === 'DRAFT') client.status = 'PENDING_VERIFICATION';
      return ok(clientOnboardingDetail(client));
    },
  ],
  [
    'POST',
    /^\/clients\/([^/]+)\/onboarding\/documents\/([^/]+)\/decide$/,
    ({ params, body }) => {
      const client = (db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found'));
      const doc = (client.documents ?? []).find((d: any) => d.kind === params[1]);
      if (!doc) fail(404, 'NOT_FOUND', 'That document has not been uploaded yet');
      if (body.status === 'REJECTED' && !String(body.reason ?? '').trim()) {
        fail(400, 'REASON_REQUIRED', 'Say why the document was rejected — the client has to be told what to fix.');
      }
      doc.status = body.status;
      doc.rejectReason = body.status === 'REJECTED' ? body.reason : null;
      doc.verifiedAt = helpers.now();
      doc.verifiedByName = 'You';
      return ok(clientOnboardingDetail(client));
    },
  ],
  [
    'POST',
    /^\/clients\/([^/]+)\/onboarding\/activate$/,
    ({ params }) => {
      const client = (db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found'));
      const gate = clientOnboardingGate(client);
      // Refusing is the point — an activation that could be forced past its
      // own checklist would make the checklist decoration.
      if (!gate.canActivate) {
        fail(400, 'ONBOARDING_INCOMPLETE', 'This client cannot be cleared yet — some papers are still outstanding.', {
          unmet: gate.unmet,
        });
      }
      client.status = 'ACTIVE';
      client.rejectionReason = null;
      return ok(clientOnboardingDetail(client));
    },
  ],
  [
    'POST',
    /^\/clients\/([^/]+)\/onboarding\/reject$/,
    ({ params, body }) => {
      const client = (db.clients.find((c: any) => c.id === params[0] || c.code === params[0]) ?? fail(404, 'NOT_FOUND', 'Client not found'));
      if (!String(body.reason ?? '').trim()) {
        fail(400, 'REASON_REQUIRED', 'Say why the client was declined — it is recorded against them.');
      }
      client.status = 'REJECTED';
      client.rejectionReason = body.reason;
      return ok(clientOnboardingDetail(client));
    },
  ],
  ['GET', /^\/clients$/, ({ query }) => {
    const q = (query.get('q') ?? '').toLowerCase();
    return ok(db.clients.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)));
  }],
  [
    'POST',
    /^\/clients$/,
    ({ body }) => {
      // Matches the migration's new default: creating a client is no longer
      // the same act as approving one. It lands in Compliance's queue.
      const client = { id: `c-${db.clients.length + 1}`, code: nextNumber('CLIENT'), status: 'DRAFT', documents: [], outstandingPaise: 0, ...body };
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
    ({ query, role, branch }) => {
      const stage = query.get('stage');
      const client = query.get('client');
      return ok(
        scopeBranch(db.indents, branch)
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
      /*
       * The client has to have been cleared by Compliance first — the gate
       * that makes client onboarding mean something rather than being a form
       * somebody fills in while work carries on regardless. Mirrors
       * `indentBlockReason` in internal-api so the fixture refuses what the
       * real API refuses, and says the same thing about why.
       */
      const forClient = db.clients.find((c: any) => c.id === body.clientId);
      // Reads as a guard because it is one. This form only compiles because
      // `fail` is declared `: never` — before that it inferred `void`, did
      // not narrow, and the next line was a type error.
      if (!forClient) fail(404, 'CLIENT_NOT_FOUND', 'That client does not exist.');
      if (forClient.status !== 'ACTIVE') {
        const why: Record<string, string> = {
          DRAFT: 'This client has not been submitted for checks yet. Compliance has to clear them before we can carry for them.',
          PENDING_VERIFICATION: 'Compliance is still checking this client’s papers. The load can be raised once they are cleared.',
          REJECTED: 'Compliance declined this client, so no work can be booked against them.',
          INACTIVE: 'This client has been stood down. Reactivate them before booking new work.',
        };
        fail(422, 'CLIENT_NOT_CLEARED', why[forClient.status] ?? 'This client has not been cleared for work.');
      }

      if (body.rateSource === 'SPOT' && !body.spotConfirmationAttachmentId)
        fail(400, 'SPOT_CONFIRMATION_REQUIRED', 'A spot indent needs the client’s written rate confirmation (BR-26).');
      if (body.rateSource === 'SPOT' && body.sellRatePaise <= body.sourcingRatePaise)
        fail(400, 'SPOT_BELOW_SOURCING', 'A spot freight must exceed the sourcing rate (BR-38).');
      const indent = {
        id: `i-${db.indents.length + 1}`,
        code: nextNumber('INDENT'),
        stage: 'OPEN',
        createdAt: helpers.now(),
        updatedAt: helpers.now(),
        buyRatePaise: null,
        vendorId: null,
        awardedQuoteId: null,
        quotes: [],
        failureCause: null,
        // Same rule as the real API (BR-20): the branch comes from the pickup
        // city, not from anything the form sends.
        branchName:
          BRANCHES.find((b) => b.city.toLowerCase() === String(body.fromCity ?? '').toLowerCase())?.name ?? 'Nashik',
        clientName: db.clients.find((c) => c.id === body.clientId)?.name ?? '—',
        distanceKm: 0,
        ...body,
        // The bid band is the client's, copied from the lane in force for this
        // route on the pickup date — never typed on the form. No lane, no band.
        ...(() => {
          const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
          const lane = (db.rateCards[body.clientId] ?? [])
            .filter(
              (l: any) =>
                !l.deletedAt &&
                norm(l.origin) === norm(body.fromCity) &&
                norm(l.destination) === norm(body.toCity) &&
                norm(l.truckType) === norm(body.truckType) &&
                l.validFrom <= body.pickupDate &&
                (!l.validTo || l.validTo >= body.pickupDate),
            )
            .sort((a: any, b: any) => String(b.validFrom).localeCompare(String(a.validFrom)))[0];
          const bidMinPaise = lane?.bidMinPaise ?? null;
          const bidMaxPaise = lane?.bidMaxPaise ?? null;
          return { bidMinPaise, bidMaxPaise, bandLocked: bidMinPaise !== null || bidMaxPaise !== null };
        })(),
        // Only a typed figure is an override; blank means the awarded
        // transporter's standing policy fills it in at award (BR-30).
        advancePct: body.advancePct ?? 0,
        advancePctOverridden: body.advancePct !== undefined && body.advancePct !== null,
      };
      db.indents.unshift(indent);
      return ok(indent);
    },
  ],
  // Declared before `/indents/:id`, or "stale" would be read as an indent code.
  ['GET', /^\/indents\/stale$/, () => {
    const cutoff = Date.now() - 7 * 86_400_000;
    return ok(
      db.indents
        .filter((i: any) => ['OPEN', 'VENDOR_ASSIGNED', 'VEHICLE_PLACED', 'TRIP_CREATED'].includes(i.stage))
        .filter((i: any) => {
          const last = Math.max(new Date(i.updatedAt ?? i.createdAt ?? 0).getTime(), new Date(i.lastReviewedAt ?? 0).getTime());
          return last < cutoff;
        })
        .map((i: any) => {
          const last = Math.max(new Date(i.updatedAt ?? i.createdAt ?? 0).getTime(), new Date(i.lastReviewedAt ?? 0).getTime());
          return {
            id: i.id,
            code: i.code,
            clientName: i.clientName,
            lane: `${i.fromCity} → ${i.toCity}`,
            stage: i.stage,
            pickupDate: i.pickupDate,
            idleDays: Math.floor((Date.now() - last) / 86_400_000),
          };
        }),
    );
  }],
  ['GET', /^\/indents\/([^/]+)$/, ({ params }) => ok(indentView(findIndent(params[0])))],

  /* ------------------------------------------------------------- orders --- */
  [
    'GET',
    /^\/orders$/,
    ({ query, branch }) => {
      // Capped the same way the real controller caps it — the screen this
      // replaces had no paging at all and pulled every row.
      const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 200);
      const offset = Math.max(Number(query.get('offset')) || 0, 0);
      const all = searchOrders(query, branch);
      return ok({ rows: all.slice(offset, offset + limit), total: all.length, limit, offset });
    },
  ],
  [
    'GET',
    /^\/orders\/counts$/,
    ({ query, branch }) => {
      const counts: Record<string, number> = {};
      for (const row of searchOrders(query, branch, true)) {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
      }
      return ok(counts);
    },
  ],
  [
    'GET',
    /^\/orders\/([^/]+)$/,
    ({ params, role, branch }) => {
      const indent = findIndent(params[0]);
      const row = orderRow(indent);
      const trip = row.tripId ? db.trips.find((t: any) => t.id === row.tripId) : null;
      return ok({
        ...row,
        clientId: indent.clientId,
        fromCity: indent.fromCity,
        toCity: indent.toCity,
        material: indent.material,
        weightTn: indent.weightTn,
        truckType: indent.truckType,
        vendorName: trip?.vendorName ?? null,
        vehicleNo: trip?.vehicleNo ?? null,
        driverName: trip?.driverName ?? null,
        driverPhone: trip?.driverPhone ?? indent.driverPhone ?? null,
        buyRatePaise: indent.buyRatePaise ?? null,
        advancePaidPaise: trip?.advancePaidPaise ?? 0,
        balancePaidPaise: trip?.balancePaidPaise ?? 0,
        remarks: indent.remarks ?? null,
        // Everything about the order on its Details tab — same fields as
        // `OrdersService.getById`.
        pickupAddress: indent.pickupAddress ?? null,
        dropAddress: indent.dropAddress ?? null,
        vendorCode: trip ? (db.vendors.find((v: any) => v.id === trip.vendorId)?.code ?? null) : null,
        vendorPhone: trip ? (db.vendors.find((v: any) => v.id === trip.vendorId)?.phone ?? null) : null,
        tripStage: trip?.stage ?? null,
        milestones: {
          reachedLoadingAt: trip?.reachedLoadingAt ?? null,
          loadedAt: trip?.loadingCompletedAt ?? null,
          departedAt: trip?.departedAt ?? null,
          reachedDestinationAt: trip?.reachedDestinationAt ?? null,
          deliveredAt: trip?.deliveredAt ?? null,
        },
        podStatus: trip?.podStatus ?? null,
        invoice: (() => {
          const inv = row.invoiceId ? db.invoices.find((i: any) => i.id === row.invoiceId) : null;
          return inv
            ? {
                id: inv.id,
                code: inv.code ?? null,
                status: inv.status,
                invoiceDate: inv.invoiceDate ?? null,
                totalPaise: Number(inv.totalPaise ?? 0),
                receivedPaise: Number(inv.receivedPaise ?? 0),
              }
            : null;
        })(),
        payments: orderPaymentsFor(indent, trip, role, branch),
        events: orderEvents(row),
        comments: orderCommentsFor(indent.id),
      });
    },
  ],
  [
    'POST',
    /^\/orders\/([^/]+)\/comments$/,
    ({ params, body, userId }) => {
      const indent = findIndent(params[0]);
      const text = String(body?.body ?? '').trim();
      if (!text) fail(400, 'VALIDATION_ERROR', 'Write something before adding the comment.');
      if (text.length > 2000) fail(400, 'VALIDATION_ERROR', 'Keep a comment under 2,000 characters.');
      db.orderComments.push({
        id: `oc-${Date.now()}-${db.orderComments.length + 1}`,
        orderId: indent.id,
        body: text,
        at: helpers.now(),
        authorName: ACCOUNTS.find((a) => a.userId === userId)?.name ?? 'You',
      });
      return ok(orderCommentsFor(indent.id));
    },
  ],
  [
    'POST',
    /^\/orders\/([^/]+)\/recompute$/,
    ({ params }) => ok(orderRow(findIndent(params[0]))),
  ],
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
          action: { indentId: indent.id, quoteId: quote.id },
        });
      if (indent.stage !== 'OPEN' || quote.status !== 'SUBMITTED')
        fail(409, 'QUOTE_NOT_AWARDABLE', `Quote ${quote.code ?? quote.id} is already ${quote.status}.`);
      applyMockAward(indent, quote);
      touchIndent(indent);
      return ok(indentView(indent));
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/placement$/,
    ({ params, body }) => {
      const indent = findIndent(params[0]);
      if (indent.stage !== 'VENDOR_ASSIGNED' && indent.stage !== 'TRIP_CREATED')
        fail(409, 'NOT_AWARDED', 'A vehicle can only be placed on an awarded indent.');
      const trip = indent.stage === 'TRIP_CREATED' ? tripForIndent(indent) : undefined;
      if (indent.stage === 'TRIP_CREATED') {
        if (!trip) fail(409, 'NO_TRIP', 'This indent has no trip to allocate a vehicle to.');
        if (trip.stage !== 'OPEN')
          fail(409, 'TRIP_UNDERWAY', 'The trip has left OPEN; its vehicle can no longer be changed here.');
      }
      // Same rule as PlacementDto: the vehicle and the driver's mobile are
      // required; name and licence are optional.
      const driverPhone = String(body.driverPhone ?? '').replace(/\s/g, '');
      if (!String(body.vehicleNo ?? '').trim()) fail(400, 'VALIDATION_ERROR', 'Enter the vehicle number.');
      if (!/^(\+91|0)?[6-9]\d{9}$/.test(driverPhone))
        fail(400, 'VALIDATION_ERROR', 'Enter the driver’s 10-digit mobile number.');
      const driver = {
        vehicleNo: String(body.vehicleNo).trim().toUpperCase(),
        driverPhone,
        driverName: String(body.driverName ?? '').trim() || null,
        driverLicence: String(body.driverLicence ?? '').trim() || null,
      };
      // The truck coming off the transporter's "available" list is what the
      // fleet board and their portal both read — it is on this trip now.
      releaseFleetVehicle(indent.vendorId, indent.vehicleNo);
      Object.assign(indent, {
        ...driver,
        reportedAt: body.reportedAt,
        stage: trip ? 'TRIP_CREATED' : 'VEHICLE_PLACED',
        transitDelay: !!body.transitDelay,
        placementRemarks: body.remarks ?? null,
      });
      setFleetVehicleStatus(indent.vendorId, driver.vehicleNo, 'ON_TRIP');
      if (trip) Object.assign(trip, driver);
      touchIndent(indent);
      return ok(indentView(indent));
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/trip$/,
    ({ params }) => {
      const indent = findIndent(params[0]);
      if (indent.stage !== 'VEHICLE_PLACED')
        fail(409, 'NOT_PLACED', 'A trip can only be created once the vehicle is placed.');
      const trip = openTripFor(indent);
      indent.stage = 'TRIP_CREATED';
      return ok(trip);
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/cancel$/,
    ({ params, body }) => {
      const indent = findIndent(params[0]);
      if (String(body?.reason ?? '').trim().length < 5) fail(400, 'VALIDATION_ERROR', 'Say why the load is being cancelled.');
      if (indent.stage === 'CANCELLED') fail(409, 'ALREADY_CANCELLED', 'This indent is already cancelled.');
      const trip = tripForIndent(indent);
      if (trip && trip.stage !== 'CANCELLED') {
        if (trip.stage !== 'OPEN' || trip.advancePaidPaise > 0)
          fail(409, 'TRIP_UNDERWAY', 'The truck has already left or an advance has been paid, so this load cannot simply be cancelled. Settle it first.');
        trip.stage = 'CANCELLED';
      }
      releaseFleetVehicle(indent.vendorId, indent.vehicleNo);
      indent.quotes.forEach((q: any) => {
        if (['SUBMITTED', 'ACCEPTED'].includes(q.status)) q.status = 'WITHDRAWN';
      });
      indent.stage = 'CANCELLED';
      indent.cancelReason = String(body.reason).trim();
      indent.cancelledAt = helpers.now();
      touchIndent(indent);
      return ok(indentView(indent));
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/keep$/,
    ({ params }) => {
      const indent = findIndent(params[0]);
      if (indent.stage === 'CANCELLED') fail(409, 'ALREADY_CANCELLED', 'This indent is cancelled.');
      indent.lastReviewedAt = helpers.now();
      return ok({ id: indent.id, kept: true });
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/reassign-transporter$/,
    ({ params, body }) => {
      const indent = findIndent(params[0]);
      if (String(body?.reason ?? '').trim().length < 5) fail(400, 'VALIDATION_ERROR', 'Say why the transporter is being changed.');
      if (indent.stage !== 'TRIP_CREATED') fail(409, 'NOT_AWARDED', 'Only an awarded load has a transporter to reassign.');
      const trip = tripForIndent(indent);
      if (!trip || trip.stage !== 'OPEN' || trip.advancePaidPaise > 0)
        fail(409, 'TRIP_UNDERWAY', 'The truck has already left or an advance has been paid, so the transporter cannot be swapped here.');
      if (trip.lr?.status && !['DRAFT', 'BOOKED'].includes(trip.lr.status))
        fail(409, 'LR_ISSUED', 'A lorry receipt has been issued for this transporter. Cancel it before reassigning.');
      trip.stage = 'CANCELLED';
      releaseFleetVehicle(indent.vendorId, indent.vehicleNo);
      indent.quotes.forEach((q: any) => {
        if (q.id === indent.awardedQuoteId) q.status = 'WITHDRAWN';
        else if (q.status === 'REJECTED') q.status = 'SUBMITTED';
      });
      Object.assign(indent, {
        stage: 'OPEN',
        vendorId: null,
        awardedQuoteId: null,
        buyRatePaise: null,
        vehicleNo: null,
        driverName: null,
        driverLicence: null,
        driverPhone: null,
        reportedAt: null,
      });
      touchIndent(indent);
      return ok(indentView(indent));
    },
  ],
  [
    'POST',
    /^\/indents\/([^/]+)\/quotes$/,
    ({ params, body }) => {
      const indent = findIndent(params[0]);
      if (indent.stage !== 'OPEN')
        fail(409, 'INDENT_NOT_OPEN', 'Quotes can only be entered while the indent is still open.');
      const vendor = db.vendors.find((v) => v.id === body.vendorId) ?? fail(404, 'NOT_FOUND', 'Unknown transporter.');
      if (vendor.status !== 'ACTIVE') fail(409, 'VENDOR_NOT_ACTIVE', 'Only an active transporter can be quoted for.');
      if (!Number.isInteger(body.amountPaise) || body.amountPaise < 1)
        fail(400, 'VALIDATION', 'Enter the quote as a positive amount.');
      if (indent.quotes.some((q: any) => q.vendorId === vendor.id))
        fail(409, 'QUOTE_EXISTS', 'This transporter already has a quote on this indent.');
      indent.quotes.push({
        id: `q-${indent.id}-${indent.quotes.length + 1}-${Date.now()}`,
        code: nextNumber('QUOTE'),
        vendorId: vendor.id,
        vendorName: vendor.legalName,
        vendorStatus: vendor.status,
        amountPaise: body.amountPaise,
        truckRegistration: body.truckRegistration ?? '',
        // Below the floor is kept and flagged, not refused.
        bandPosition: bandPositionFor(body.amountPaise, indent.bidMinPaise ?? null, indent.bidMaxPaise ?? null),
        status: 'SUBMITTED',
        submittedAt: helpers.now(),
        remarks: body.remarks ?? null,
      });
      touchIndent(indent);
      return ok(indentView(indent));
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
    ({ query, role, branch }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      const stage = query.get('stage');
      const podStatus = query.get('pod_status');
      // On the road or later, and not on a client invoice yet — the trips a bill can be raised for.
      const invoiceable = query.get('invoiceable') === '1';
      return ok(
        scopeBranch(db.trips, branch)
          .filter((t) => !stage || stage.split(',').includes(t.stage))
          .filter((t) => !invoiceable || (['IN_TRANSIT', 'DELIVERED', 'CLOSED'].includes(t.stage) && !t.billed))
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
  [
    'GET',
    /^\/trips\/loading\/mine$/,
    ({ userId }) => {
      return ok(
        db.trips
          .filter((t: any) => t.stage === 'OPEN' && t.loadingSupervisorId === userId)
          .map((t: any) => ({
            ...tripSummary(t),
            loadingStartedAt: t.loadingStartedAt ?? null,
            loadingCompletedAt: t.loadingCompletedAt ?? null,
          })),
      );
    },
  ],
  [
    'GET',
    /^\/trips\/([^/]+)\/loading\/supervisors$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      const branchCode = BRANCHES.find((b) => b.id === trip.branchId)?.code ?? null;
      return ok(
        ACCOUNTS.filter((a) => a.role === 'LOADING_SUPERVISOR' && (a.branch === null || a.branch === branchCode)).map((a) => ({
          id: a.userId,
          name: a.name,
          branchId: a.branch ? (BRANCHES.find((b) => b.code === a.branch)?.id ?? null) : null,
        })),
      );
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/loading\/supervisor$/,
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      if (trip.stage !== 'OPEN') fail(409, 'NOT_OPEN', `Trip ${trip.code} is not OPEN (currently ${trip.stage}).`);
      if (trip.loadingCompletedAt)
        fail(409, 'LOADING_DONE', 'Loading is already complete; the supervisor can no longer change.');
      const branchCode = BRANCHES.find((b) => b.id === trip.branchId)?.code ?? null;
      const person = ACCOUNTS.find((a) => a.userId === body?.userId && a.role === 'LOADING_SUPERVISOR');
      if (!person) fail(422, 'NOT_A_SUPERVISOR', 'Only an active loading supervisor can be assigned to a trip.');
      if (person.branch && person.branch !== branchCode)
        fail(422, 'WRONG_BRANCH', 'That person works from a different branch than this trip.');
      if (trip.loadingSupervisorId !== person.userId) trip.loadingStartedAt = null;
      trip.loadingSupervisorId = person.userId;
      trip.loadingSupervisorName = person.name;
      return ok(trip);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/loading\/start$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      if (trip.stage !== 'OPEN') fail(409, 'NOT_OPEN', `Trip ${trip.code} is not OPEN (currently ${trip.stage}).`);
      if (!trip.loadingSupervisorId) fail(409, 'NO_SUPERVISOR', 'Assign a loading supervisor before loading starts.');
      if (!trip.vehicleNo) fail(409, 'NO_VEHICLE', 'Allocate the vehicle before loading starts.');
      if (trip.loadingStartedAt) fail(409, 'LOADING_STARTED', 'Loading has already started.');
      trip.loadingStartedAt = helpers.now();
      // Loading starts at the loading point, so the truck has reached it.
      trip.reachedLoadingAt ??= trip.loadingStartedAt;
      return ok(trip);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/loading\/complete$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      if (trip.stage !== 'OPEN') fail(409, 'NOT_OPEN', `Trip ${trip.code} is not OPEN (currently ${trip.stage}).`);
      if (!trip.loadingStartedAt) fail(409, 'LOADING_NOT_STARTED', 'Loading has not started yet.');
      if (trip.loadingCompletedAt) fail(409, 'LOADING_DONE', 'Loading is already complete.');
      trip.loadingCompletedAt = helpers.now();
      return ok(trip);
    },
  ],
  ['GET', /^\/trips\/([^/]+)\/documents$/, ({ params }) => ok(findTrip(params[0]).documents)],
  [
    'POST',
    /^\/trips\/([^/]+)\/documents\/([^/]+)\/verify$/,
    ({ params, body, role, userId }) => {
      const trip = findTrip(params[0]);
      const doc = trip.documents.find((d: any) => d.kind === params[1]) ?? fail(404, 'NOT_FOUND', 'Document not found');
      if (doc.status === 'MISSING') fail(409, 'NOT_UPLOADED', 'Nothing has been uploaded to verify.');
      // The verification team types the details off the document as they check it.
      if (body?.keyedValues && typeof body.keyedValues === 'object')
        doc.keyedValues = { ...(doc.keyedValues ?? {}), ...body.keyedValues };
      doc.status = 'VERIFIED';
      doc.verifiedBy = personName(userId, role);
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
    ({ params, body, role, userId }) => {
      const trip = findTrip(params[0]);
      // The proof of delivery comes after unloading, never before.
      if (params[1] === 'POD' && !trip.deliveredAt)
        fail(409, 'NOT_DELIVERED', 'The proof of delivery is uploaded once the truck is unloaded.');
      let doc = trip.documents.find((d: any) => d.kind === params[1]);
      if (!doc) {
        doc = {
          kind: params[1],
          label: DOC_LABEL[params[1]] ?? params[1],
          group: (['LOADING_SLIP', 'WEIGHMENT_SLIP'].includes(params[1])
            ? 'LOADING'
            : params[1] === 'LR'
              ? 'LR'
              : params[1] === 'POD'
                ? 'POD'
                : params[1] === 'DRIVING_LICENCE'
                  ? 'DRIVER'
                  : ['RC', 'INSURANCE', 'FITNESS', 'PERMIT', 'PUC'].includes(params[1])
                    ? 'VEHICLE'
                    : 'CLIENT') as any,
          gatesAdvance: ADVANCE_DOCUMENT_SET.includes(params[1]),
          keyedValues: {},
        };
        trip.documents.push(doc);
      }
      Object.assign(doc, {
        status: 'PENDING',
        attachmentId: body?.attachmentId ?? `att-${params[1].toLowerCase()}`,
        uploadedAt: helpers.now(),
        uploadedBy: personName(userId, role),
        // A new file is checked again — the old verification was of the old file.
        verifiedBy: null,
        verifiedAt: null,
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
  // (a trip with no receipt yet answers null; the first save or issue builds a whole one)
  [
    'PATCH',
    /^\/trips\/([^/]+)\/lr$/,
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      trip.lr = { ...(trip.lr ?? blankLr(trip)), ...body };
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
      // Matches trips.repository.ts's `finalizeLr`: generating an LR sets it
      // RELEASED directly, not BOOKED — BOOKED is only the pre-generate draft
      // placeholder. depart() below gates on RELEASED specifically.
      trip.lr = { ...(trip.lr ?? blankLr(trip)), code: trip.lrCode, status: 'RELEASED', lrDate: helpers.now(), bookedAt: helpers.now() };
      return ok(trip.lr);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/lr\/share$/,
    ({ params }) => {
      const trip = findTrip(params[0]);
      trip.lr = { ...(trip.lr ?? blankLr(trip)), sharedAt: helpers.now() };
      return ok(trip.lr);
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/depart$/,
    ({ params, userId }) => ok(departMockTrip(findTrip(params[0]), userId)),
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/eway-extension$/,
    // `TripsService.extendEway` — the e-way bill extended while the truck is on the road.
    ({ params, body, userId, role }) => {
      const trip = findTrip(params[0]);
      if (!(trip.loadingSupervisorId === userId) && !roleCan(role, 'indent.manage'))
        fail(403, 'PERMISSION_DENIED', 'Missing permission: indent.manage.');
      if (trip.stage !== 'OPEN' && trip.stage !== 'IN_TRANSIT')
        fail(409, 'TRACKING_CLOSED', 'The truck is unloaded; the e-way bill no longer needs extending.');
      const doc = (trip.documents ?? []).find((d: any) => d.kind === 'EWAY_BILL');
      if (!doc || !doc.attachmentId || doc.status === 'MISSING')
        fail(409, 'NO_EWAY_BILL', 'Upload the e-way bill on the Documents tab first.');
      const validTill = String(body?.validTill ?? '');
      if (!/^\d{4}-\d{2}-\d{2}/.test(validTill)) fail(400, 'VALIDATION_ERROR', 'Give the new validity date.');
      const current: string | null = doc.keyedValues?.validTill ?? trip.ewayValidTill ?? null;
      if (current && validTill.slice(0, 10) <= String(current).slice(0, 10))
        fail(400, 'VALIDATION_ERROR', `The new validity must be after the current one (${String(current).slice(0, 10)}).`);
      const ewayNo = String(body?.ewayNo ?? '').trim() || doc.keyedValues?.ewayNo || null;
      doc.keyedValues = { ...(doc.keyedValues ?? {}), validTill: validTill.slice(0, 10), ...(ewayNo ? { ewayNo } : {}) };
      trip.ewayValidTill = validTill.slice(0, 10);
      // The fleet board's e-way alert follows the new date.
      const tele = db.telematics.find((v: any) => v.vehicleNo === trip.vehicleNo);
      if (tele) {
        tele.ewayValidTill = `${validTill.slice(0, 10)}T23:59:00+05:30`;
        tele.alerts = (tele.alerts ?? []).filter((a: string) => !a.startsWith('EWAY_'));
      }
      const last = db.tripTracking.filter((u: any) => u.tripId === trip.id && u.kind !== 'UNLOADED').pop();
      const reason = String(body?.reason ?? '').trim();
      addTrackingRow(trip, {
        kind: 'EWAY_EXTENDED',
        location: last?.location ?? (String(trip.lane ?? '').split('→')[0]?.trim() || 'On the road'),
        lat: null,
        lng: null,
        note: `E-way bill extended to ${validTill.slice(0, 10)}${current ? ` (was ${String(current).slice(0, 10)})` : ''}${reason ? ` — ${reason}` : ''}`,
        at: helpers.now(),
        userId,
      });
      return ok(trackingSheetFor(trip));
    },
  ],
  [
    'GET',
    /^\/trips\/([^/]+)\/tracking$/,
    ({ params }) => ok(trackingSheetFor(findTrip(params[0]))),
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/tracking$/,
    // Mirrors `TripsService.addTracking`: a position update, or a milestone in
    // the order cycle — reached the loading point, loaded, reached the unloading point.
    ({ params, body, userId, role }) => {
      const trip = findTrip(params[0]);
      if (!(trip.loadingSupervisorId === userId) && !roleCan(role, 'indent.manage'))
        fail(403, 'PERMISSION_DENIED', 'Missing permission: indent.manage.');
      if (!trip.vehicleNo)
        fail(409, 'NOT_PLACED', 'Allocate the vehicle first — tracking starts once a truck is on this load.');
      const kind = String(body?.kind ?? '');
      if (!['UPDATE', 'REACHED_LOADING', 'LOADED', 'REACHED'].includes(kind)) fail(400, 'VALIDATION_ERROR', 'Unknown tracking step.');
      const hasLat = body?.lat !== undefined && body?.lat !== null && body?.lat !== '';
      const hasLng = body?.lng !== undefined && body?.lng !== null && body?.lng !== '';
      if (hasLat !== hasLng) fail(400, 'VALIDATION_ERROR', 'Give both latitude and longitude, or neither.');
      const at = body?.at ?? helpers.now();
      const [fromCity, toCity] = String(trip.lane ?? '').split('→').map((x: string) => x.trim());
      let location = String(body?.location ?? '').trim();
      if (kind === 'UPDATE') {
        if (trip.stage !== 'OPEN' && trip.stage !== 'IN_TRANSIT')
          fail(409, 'TRACKING_CLOSED', 'This truck has been unloaded; the tracking sheet is closed.');
        if (location.length < 2) fail(400, 'VALIDATION_ERROR', 'Say where the truck is.');
      } else if (kind === 'REACHED_LOADING') {
        if (trip.stage !== 'OPEN') fail(409, 'NOT_OPEN', 'This truck has already left the loading point.');
        if (trip.reachedLoadingAt) fail(409, 'ALREADY_MARKED', 'Already marked as reached the loading point.');
        location ||= fromCity || 'Loading point';
        trip.reachedLoadingAt = at;
        trip.loadingStartedAt ??= at;
      } else if (kind === 'LOADED') {
        if (trip.stage !== 'OPEN') fail(409, 'NOT_OPEN', 'This truck has already left the loading point.');
        if (trip.loadingCompletedAt) fail(409, 'ALREADY_MARKED', 'Already marked as loaded.');
        if (!trip.reachedLoadingAt) fail(409, 'NOT_AT_LOADING_POINT', 'Mark the truck as reached the loading point first.');
        location ||= fromCity || 'Loading point';
        trip.loadingCompletedAt = at;
        trip.loadingStartedAt ??= trip.reachedLoadingAt;
      } else if (kind === 'REACHED') {
        if (trip.stage !== 'IN_TRANSIT') fail(409, 'NOT_IN_TRANSIT', 'Only a truck on the road can reach the unloading point.');
        if (trip.reachedDestinationAt) fail(409, 'ALREADY_MARKED', 'Already marked as reached the unloading point.');
        location ||= toCity || 'Unloading point';
        trip.reachedDestinationAt = at;
      }
      addTrackingRow(trip, {
        kind,
        location,
        lat: hasLat ? Number(body.lat) : null,
        lng: hasLat ? Number(body.lng) : null,
        note: String(body?.note ?? '').trim() || null,
        at,
        userId,
        status: kind === 'UPDATE' ? (body?.status ?? null) : null,
      });
      // A typed position with coordinates also moves the truck on the fleet board.
      if (hasLat && trip.stage === 'IN_TRANSIT') {
        const row = db.telematics.find((v: any) => v.vehicleNo === trip.vehicleNo);
        if (row) Object.assign(row, { lat: Number(body.lat), lng: Number(body.lng), lastPingAt: at });
      }
      return ok(trackingSheetFor(trip));
    },
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/deliver$/,
    ({ params, body, userId }) => {
      const trip = findTrip(params[0]);
      if (trip.stage !== 'IN_TRANSIT') {
        fail(409, 'NOT_IN_TRANSIT', `Trip ${trip.code} is not IN_TRANSIT (currently ${trip.stage}).`);
      }
      trip.stage = 'DELIVERED';
      trip.deliveredAt = body?.deliveredAt ?? helpers.now();
      trip.podStatus = 'PENDING';
      // Unloading happens at the unloading point, whether or not anyone marked arriving there.
      trip.reachedDestinationAt ??= trip.deliveredAt;
      addTrackingRow(trip, {
        kind: 'UNLOADED',
        location: String(trip.lane ?? '').split('→')[1]?.trim() || 'Unloading point',
        lat: null,
        lng: null,
        note: null,
        at: trip.deliveredAt,
        userId,
      });
      // By the lane's own terms, counted from the day loading was done.
      const laneOfTrip = (db.rateCards[trip.clientId] ?? []).find(
        (l: any) => l.id === db.indents.find((i: any) => i.id === trip.indentId)?.rateCardLaneId,
      );
      const transit = computeTransitPenalty({
        startedAt: trip.loadingCompletedAt ?? trip.departedAt ?? null,
        deliveredAt: trip.deliveredAt,
        requiredDays: trip.transitDaysRequired ?? null,
        applies: !!laneOfTrip?.transitPenaltyApplies,
        perDayPaise: Number(laneOfTrip?.transitPenaltyPerDayPaise ?? 0),
      });
      trip.actualTransitDays = transit.actualDays;
      trip.transitPenaltyPaise = transit.penaltyPaise;
      if (trip.lr) trip.lr = { ...trip.lr, status: 'DELIVERED' };
      // Unloaded: the truck is free again, at the delivery city.
      const [, toCity] = String(trip.lane ?? '').split('→').map((x: string) => x.trim());
      setFleetVehicleStatus(trip.vendorId, trip.vehicleNo, 'AVAILABLE', toCity || undefined);
      db.telematics = db.telematics.filter((v: any) => v.tripCode !== trip.code);
      return ok(trip);
    },
  ],
  ['GET', /^\/trips\/([^/]+)$/, ({ params }) => ok(findTrip(params[0]))],

  /* ------------------------------------------------------------- C5 ----- */
  [
    'GET',
    /^\/pod\/receiving$/,
    ({ role, branch }) => {
      const rows = scopeBranch(db.trips, branch).filter((t) => t.deliveredAt);
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
    // `scope` is who the caller is; `branch` is what they typed in the filter
    // box. Two different things that both want the name "branch" — keeping
    // them apart matters, because passing the lowercased filter text as the
    // scope silently matches no branch code and turns scoping off entirely.
    ({ role, query, branch: scope }) => {
      const branch = (query.get('branch') ?? '').trim().toLowerCase();
      const transporter = (query.get('transporter') ?? '').trim().toLowerCase();
      const ageing = query.get('ageing');
      const rows = scopeBranch(db.trips, scope)
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
            penaltyPaise: t.podPenaltyWaived ? 0 : Math.max(0, ageDays - db.config.pod_tat_days) * db.config.pod_penalty_per_day_paise,
            balanceHeldPaise: t.buyRatePaise - t.advancePaidPaise,
            forfeited: ageDays > db.config.pod_forfeit_days,
            docketNo: t.podDocketNo ?? null,
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
        indentCode: trip.indentCode,
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
        podKind: db.podReceipts.find((r) => r.tripId === trip.id)?.podKind ?? null,
        // Same shape as `PodService.getById`.
        hardCopy: (() => {
          const r = db.podReceipts.find((x) => x.tripId === trip.id);
          if (!r) return null;
          const epod = r.podKind === 'EPOD';
          return {
            courierDocket: epod ? (r.hardCopyDocket ?? null) : (r.courierDocket ?? null),
            sentOn: epod ? (r.hardCopySentOn ?? null) : (r.sentOn ?? null),
            receivedOn: epod ? (r.hardCopyReceivedOn ?? null) : (r.receivedOn ?? null),
            courierSlipAttachmentId: r.courierSlipAttachmentId ?? null,
            attachmentIds: epod ? (r.hardCopyAttachmentIds ?? []) : (r.attachmentIds ?? []),
            verifiedAt: epod ? (r.hardCopyVerifiedAt ?? null) : null,
          };
        })(),
        hardCopyHoldsBalance: (() => {
          const r = db.podReceipts.find((x) => x.tripId === trip.id);
          return r?.podKind === 'EPOD' && !r.hardCopyVerifiedAt;
        })(),
        transitPenaltyPaise: trip.transitPenaltyWaived ? 0 : Number(trip.transitPenaltyPaise ?? 0),
        actualTransitDays: trip.actualTransitDays ?? null,
        transitDaysRequired: trip.transitDaysRequired ?? null,
        pages: trip.podPages ?? 2,
        attachmentIds: db.podReceipts.find((r) => r.tripId === trip.id)?.attachmentIds?.length
          ? db.podReceipts.find((r) => r.tripId === trip.id)!.attachmentIds
          : ['att-pod-1', 'att-pod-2'],
        verifiedBy: trip.podVerifiedBy ?? null,
        approvedBy: trip.podApprovedBy ?? null,
        charges: trip.charges,
      });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/docket$/,
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      if (!trip.deliveredAt) fail(409, 'NOT_DELIVERED', 'A docket can only be recorded once the load has been delivered.');
      if (['APPROVED', 'FORFEITED', 'WAIVED'].includes(trip.podStatus))
        fail(409, 'POD_CLOSED', 'This delivery proof is already closed.');
      if (!body?.docketNo || String(body.docketNo).trim().length < 3) fail(400, 'VALIDATION_ERROR', 'Enter the docket number.');
      trip.podDocketNo = String(body.docketNo).trim();
      return ok({ tripId: trip.id, docketNo: trip.podDocketNo });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/receive$/,
    ({ params, body, role }) => {
      // H-POD — `PodService.receive`: the scan of the signed hard copy; the docket is optional.
      const trip = findTrip(params[0]);
      const ids: string[] = Array.isArray(body?.attachmentIds) ? body.attachmentIds : [];
      const docket = String(body?.courierDocket ?? '').trim() || null;
      if (ids.length === 0 && !docket) fail(400, 'VALIDATION_ERROR', 'Upload the scan of the signed hard copy.');
      const today = helpers.now().slice(0, 10);
      const receipt = {
        id: `pdr-${Date.now()}`,
        code: nextNumber('POD_RECEIPT'),
        tripId: trip.id,
        courierDocket: docket,
        sentOn: docket ? (body.sentOn || today) : null,
        receivedOn: body?.receivedOn || today,
        pages: body?.pages ?? (ids.length || null),
        receivedBy: body?.receivedBy ?? USERS[role].name,
        condition: body?.condition ?? null,
      };
      db.podReceipts.unshift({
        ...receipt,
        podKind: 'HPOD',
        attachmentIds: ids,
        courierSlipAttachmentId: body?.courierSlipAttachmentId ?? null,
      });
      trip.podStatus = 'RECEIVED';
      trip.podReceivedAt = receipt.receivedOn;
      if (docket) trip.podCourierDocket = docket;
      return ok(receipt);
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/hard-copy\/verify$/,
    // The check on the hard copy behind an E-POD — `PodService.verifyHardCopy`.
    ({ params, role }) => {
      const trip = findTrip(params[0]);
      const receipt = db.podReceipts.find((r) => r.tripId === trip.id);
      if (!receipt || receipt.podKind !== 'EPOD')
        fail(409, 'NO_EPOD', 'There is no E-POD on this trip, so no separate hard copy to verify.');
      if ((receipt.hardCopyAttachmentIds ?? []).length === 0)
        fail(409, 'HARD_COPY_NOT_UPLOADED', 'Upload the scan of the hard copy before verifying it.');
      if (receipt.hardCopyVerifiedAt) fail(409, 'HARD_COPY_ALREADY_VERIFIED', 'The hard copy is already verified.');
      receipt.hardCopyVerifiedAt = helpers.now();
      return ok({ tripId: trip.id, verifiedAt: receipt.hardCopyVerifiedAt, verifiedBy: USERS[role].name });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/hard-copy$/,
    // The hard copy (H-POD) behind an E-POD — `PodService.logHardCopy`: its scan and/or its docket.
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      const receipt = db.podReceipts.find((r) => r.tripId === trip.id);
      if (!receipt || receipt.podKind !== 'EPOD')
        fail(409, 'NO_EPOD', 'The hard copy is followed up after an E-POD. Upload the E-POD first, or upload the H-POD directly.');
      const ids: string[] = Array.isArray(body?.attachmentIds) ? body.attachmentIds : [];
      const docket = String(body?.courierDocket ?? '').trim() || null;
      if (ids.length === 0 && !docket)
        fail(400, 'VALIDATION_ERROR', 'Upload the scan of the hard copy, or enter its courier docket.');
      const today = helpers.now().slice(0, 10);
      const sentOn = body?.sentOn ?? (docket ? (receipt.hardCopySentOn ?? today) : undefined);
      const receivedOn = ids.length > 0 ? (body?.receivedOn ?? today) : body?.receivedOn;
      if (receivedOn && sentOn && receivedOn < sentOn)
        fail(400, 'VALIDATION_ERROR', 'The hard copy cannot reach head office before it was sent.');
      Object.assign(receipt, {
        ...(docket ? { hardCopyDocket: docket } : {}),
        ...(sentOn ? { hardCopySentOn: sentOn } : {}),
        ...(receivedOn ? { hardCopyReceivedOn: receivedOn } : {}),
        ...(body?.courierSlipAttachmentId ? { courierSlipAttachmentId: body.courierSlipAttachmentId } : {}),
        // A new scan replaces the old one and needs checking again.
        ...(ids.length > 0 ? { hardCopyAttachmentIds: ids, hardCopyVerifiedAt: null } : {}),
      });
      return ok({
        tripId: trip.id,
        courierDocket: receipt.hardCopyDocket ?? null,
        sentOn: receipt.hardCopySentOn ?? null,
        receivedOn: receipt.hardCopyReceivedOn ?? null,
        courierSlipAttachmentId: receipt.courierSlipAttachmentId ?? null,
        attachmentIds: receipt.hardCopyAttachmentIds ?? [],
        verifiedAt: receipt.hardCopyVerifiedAt ?? null,
      });
    },
  ],
  [
    'POST',
    /^\/pod\/([^/]+)\/epod$/,
    // E-POD — `PodService.uploadEpod`: the proof as a photo or scan, no courier docket.
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      if (!trip.deliveredAt) fail(409, 'NOT_DELIVERED', 'The proof of delivery is uploaded once the truck is unloaded.');
      if (!['PENDING', 'ATTACHED', 'REJECTED'].includes(trip.podStatus))
        fail(409, 'POD_NOT_AWAITED', `This delivery proof is ${String(trip.podStatus).toLowerCase()}; there is nothing left to receive.`);
      const ids: string[] = Array.isArray(body?.attachmentIds) ? body.attachmentIds : [];
      if (ids.length === 0) fail(400, 'VALIDATION_ERROR', 'Attach the photo or scan of the signed delivery note.');
      const today = helpers.now().slice(0, 10);
      const receipt = {
        id: `pdr-${Date.now()}`,
        code: nextNumber('POD_RECEIPT'),
        tripId: trip.id,
        courierDocket: null,
        sentOn: null,
        receivedOn: today,
        pages: ids.length,
        receivedBy: USERS[role].name,
        condition: null,
        podKind: 'EPOD',
        attachmentIds: ids,
        // Optional: the hard copy's courier docket, if it has been sent already.
        hardCopyDocket: String(body?.hardCopyDocket ?? '').trim() || null,
        hardCopySentOn: String(body?.hardCopyDocket ?? '').trim() ? (body?.hardCopySentOn ?? today) : null,
        hardCopyAttachmentIds: [] as string[],
        hardCopyVerifiedAt: null as string | null,
      };
      db.podReceipts.unshift(receipt);
      trip.podStatus = 'RECEIVED';
      trip.podReceivedAt = today;
      return ok({ id: receipt.id, code: receipt.code, tripId: trip.id, podKind: 'EPOD', attachmentIds: ids, receivedOn: today });
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
      // A proof showing a shortage or damage raises the SDR from its remarks —
      // same rule as `sdrKindFromChecklist` in pod.service.ts.
      const shortOrDamaged = body?.checklist?.noShortageOrDamage === false;
      const quantityOff = body?.checklist?.quantityMatchesInvoice === false;
      let sdrCode: string | null = null;
      if (shortOrDamaged || quantityOff) {
        const kind = body?.sdrKind ?? (quantityOff && !shortOrDamaged ? 'SHORTAGE' : 'DAMAGE');
        sdrCode = raiseSdrRecord(trip, kind, String(body.remarks), body?.sdrClaimedAmountPaise ?? 0, role).code;
      }
      return ok({ tripId: trip.id, podStatus: trip.podStatus, verifiedBy: USERS[role].name, sdrCode });
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
    ({ params, body }) => {
      const trip = findTrip(params[0]);
      if (String(body?.mailSubject ?? '').trim().length < 5)
        fail(400, 'VALIDATION_ERROR', 'Put in the subject of the Leadership approval mail.');
      let waivedPaise = 0;
      if (body?.kind === 'TRANSIT_PENALTY') {
        if (trip.transitPenaltyWaived || !(trip.transitPenaltyPaise > 0))
          fail(409, 'NOTHING_TO_WAIVE', 'There is no late-delivery penalty left to waive on this trip.');
        waivedPaise = trip.transitPenaltyPaise;
        trip.transitPenaltyPaise = 0;
        trip.transitPenaltyWaived = true;
      } else {
        if (trip.podPenaltyWaived) fail(409, 'ALREADY_WAIVED', 'The delivery-proof penalty is already waived for this trip.');
        waivedPaise = trip.podPenaltyPaise ?? 0;
        trip.podPenaltyWaived = true;
      }
      db.penaltyWaivers.push({ tripId: trip.id, kind: body.kind, waivedPaise, mailSubject: String(body.mailSubject).trim(), at: helpers.now() });
      return ok({ tripId: trip.id, kind: body.kind, waivedPaise });
    },
  ],
  [
    'POST',
    /^\/sdr\/([^/]+)\/waive$/,
    ({ params, body }) => {
      const record = db.sdr.find((s) => s.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Record not found');
      if (String(body?.mailSubject ?? '').trim().length < 5)
        fail(400, 'VALIDATION_ERROR', 'Put in the subject of the Leadership approval mail.');
      if (record.status !== 'RESOLVED' || !(record.outstandingPaise > 0))
        fail(409, 'NOTHING_TO_WAIVE', `${record.code} has nothing left to waive.`);
      record.waivedPaise = (record.waivedPaise ?? 0) + record.outstandingPaise;
      db.penaltyWaivers.push({ tripId: record.tripId, kind: 'SDR_RECOVERY', waivedPaise: record.outstandingPaise, mailSubject: String(body.mailSubject).trim(), at: helpers.now() });
      record.outstandingPaise = 0;
      return ok(withRecoveries(record));
    },
  ],

  /* ------------------------------------------------------------- C6 ----- */
  [
    'GET',
    /^\/payments\/advance$/,
    ({ role, branch }) =>
      ok(
        scopeBranch(db.trips, branch)
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
    ({ params, body, headers, role, branch }) => {
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
      // Advance uploaded, verified and paid: a loaded truck goes on the road
      // now, as `PaymentsService.releaseAdvance` does. Anything still missing
      // leaves it where it is, and the order's Next step says what.
      if (trip.stage === 'OPEN') {
        try {
          departMockTrip(trip, USERS[role].userId);
        } catch {
          // Not ready to leave yet — nothing to do.
        }
      }
      return ok(payment);
    },
  ],
  [
    'GET',
    /^\/sdr$/,
    ({ query }) => {
      const status = query.get('status');
      const vendor = query.get('vendor');
      const trip = query.get('trip');
      return ok(
        db.sdr
          .filter((s) => (!status || s.status === status) && (!vendor || s.vendorId === vendor) && (!trip || s.tripId === trip))
          .map(withRecoveries),
      );
    },
  ],
  [
    'GET',
    /^\/sdr\/summary$/,
    () =>
      ok({
        open: db.sdr.filter((s) => s.status === 'OPEN').length,
        resolved: db.sdr.filter((s) => s.status === 'RESOLVED').length,
        outstandingPaise: db.sdr.reduce((a, s) => a + (s.outstandingPaise ?? 0), 0),
      }),
  ],
  [
    'GET',
    /^\/sdr\/([^/]+)$/,
    ({ params }) => ok(withRecoveries(db.sdr.find((s) => s.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Record not found'))),
  ],
  [
    'POST',
    /^\/trips\/([^/]+)\/sdr$/,
    ({ params, body, role }) => {
      const trip = findTrip(params[0]);
      if (!['DELIVERED', 'CLOSED'].includes(trip.stage))
        fail(409, 'NOT_DELIVERED', 'A shortage or damage can only be recorded once the load has been delivered.');
      if (!['SHORTAGE', 'DAMAGE', 'UNLOADING_ACK'].includes(body?.kind)) fail(400, 'VALIDATION_ERROR', 'Unknown kind.');
      if (!body?.description || String(body.description).trim().length < 5)
        fail(400, 'VALIDATION_ERROR', 'Describe what happened.');
      const record = raiseSdrRecord(trip, body.kind, String(body.description), body.claimedAmountPaise ?? 0, role);
      return ok(withRecoveries(record));
    },
  ],
  [
    'POST',
    /^\/sdr\/([^/]+)\/resolve$/,
    ({ params, body, role }) => {
      const record = db.sdr.find((s) => s.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Record not found');
      if (record.status !== 'OPEN') fail(409, 'ALREADY_RESOLVED', `${record.code} is already resolved.`);
      if (!Number.isInteger(body?.deductionPaise) || body.deductionPaise < 0)
        fail(400, 'VALIDATION_ERROR', 'Enter the amount to deduct (0 or more).');
      Object.assign(record, {
        status: 'RESOLVED',
        deductionPaise: body.deductionPaise,
        outstandingPaise: body.deductionPaise,
        resolutionNote: body.note ?? null,
        resolvedByName: USERS[role].name,
        resolvedAt: helpers.now(),
      });
      return ok(withRecoveries(record));
    },
  ],
  [
    'GET',
    /^\/payments\/balance$/,
    ({ role, branch }) =>
      ok(
        scopeBranch(db.trips, branch)
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
              transitPenaltyPaise: gate.breakdown.transitPenaltyPaise,
              sdrDeductionPaise: gate.breakdown.sdrDeductionPaise,
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
        indentCode: trip.indentCode,
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
        penaltyPaise: gate.breakdown.penaltyPaise + gate.breakdown.transitPenaltyPaise,
        deductionPaise: gate.breakdown.sdrDeductionPaise,
        netPaise: gate.breakdown.netPaise,
        tdsPaise: 0,
        releasedBy: USERS[role].name,
        releasedAt: helpers.now(),
        idempotencyKey: key,
        ...body,
      };
      db.payments.unshift(payment);
      for (const r of gate.sdrPlan.recoveries) {
        const record = db.sdr.find((s) => s.id === r.sdrId);
        if (record) record.outstandingPaise -= r.amountPaise;
        db.sdrRecoveries.push({
          sdrId: r.sdrId,
          tripId: trip.id,
          paymentId: payment.id,
          amountPaise: r.amountPaise,
          at: helpers.now(),
        });
      }
      trip.balancePaidPaise = gate.breakdown.netPaise;
      // Paying the transporter is not billing the client: the trip closes only once both are done.
      if (trip.billed) trip.stage = 'CLOSED';
      return ok(payment);
    },
  ],
  ['GET', /^\/payments\/bills$/, ({ query }) => {
    const s = query.get('status');
    return ok(s ? db.vendorBills.filter((b) => b.status === s) : db.vendorBills);
  }],
  [
    'POST',
    /^\/payments\/bills$/,
    ({ body, role }) => {
      // Same rules as `PaymentsService.raiseBill`.
      const grants: string[] = SEED_GRANTS[role] ?? [];
      if (!grants.includes('payment.release') && !grants.includes('indent.manage'))
        fail(403, 'PERMISSION_DENIED', 'Missing permission: payment.release or indent.manage.');
      const trip = findTrip(String(body?.tripId ?? ''));
      const billNo = String(body?.billNo ?? '').trim();
      if (!billNo) fail(400, 'VALIDATION_ERROR', 'Enter the number printed on the bill.');
      const billDate = String(body?.billDate ?? '').slice(0, 10);
      if (!billDate) fail(400, 'VALIDATION_ERROR', 'Enter the date on the bill.');
      if (billDate > helpers.now().slice(0, 10)) fail(400, 'BILL_DATE_FUTURE', 'The bill date cannot be in the future.');
      if (!['APPROVED', 'WAIVED'].includes(trip.podStatus))
        fail(409, 'POD_NOT_APPROVED', 'A bill can be raised once the proof of delivery is approved.');
      const live = db.vendorBills.find((b) => b.tripId === trip.id && ['SUBMITTED', 'ACCEPTED'].includes(b.status));
      if (live) fail(409, 'BILL_EXISTS', `This trip already has bill ${live.billNo}. Decide that one first.`);
      if (db.vendorBills.some((b) => b.vendorId === trip.vendorId && b.billNo === billNo))
        fail(409, 'BILL_NO_DUPLICATE', `This transporter already has a bill numbered ${billNo}.`);
      const gate = balanceGate(trip);
      const computedBalancePaise = gate.breakdown.netPaise;
      const totalPaise = Number.isInteger(body?.totalPaise) ? body.totalPaise : computedBalancePaise;
      const bill = {
        id: `vb-${Date.now()}`,
        tripId: trip.id,
        tripCode: trip.code,
        vendorId: trip.vendorId,
        vendorName: trip.vendorName,
        billNo,
        billDate,
        attachmentId: body?.attachmentId ?? null,
        freightPaise: trip.buyRatePaise,
        chargesPaise: gate.breakdown.chargeCostPaise,
        totalPaise,
        submittedAt: helpers.now(),
        computedBalancePaise,
        variancePaise: totalPaise - computedBalancePaise,
        podStatus: trip.podStatus,
        status: 'SUBMITTED',
      };
      db.vendorBills.unshift(bill);
      return ok(bill);
    },
  ],
  [
    'GET',
    /^\/payments\/bills\/([^/]+)$/,
    ({ params }) => ok(db.vendorBills.find((b) => b.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Bill not found')),
  ],
  [
    'POST',
    /^\/payments\/bills\/([^/]+)\/accept$/,
    ({ params, body, role }) => {
      const bill = db.vendorBills.find((b) => b.id === params[0]) ?? fail(404, 'NOT_FOUND', 'Bill not found');
      if (body?.atTheirFigure && !body?.reason?.trim())
        fail(400, 'REASON_REQUIRED', 'Accepting a transporter’s own figure needs a reason.');
      for (const field of ['mode', 'transferType', 'remittingAccount', 'utr', 'valueDate'])
        if (!body?.[field]) fail(400, 'PAYMENT_FIELD_REQUIRED', `${field} is required on every payment (BR-09).`);
      const netPaise = body?.atTheirFigure ? bill.totalPaise : bill.computedBalancePaise;
      bill.status = 'ACCEPTED';
      bill.acceptedAtFigurePaise = netPaise;
      // `internal-api`'s real `acceptBill()` returns `{ id, status, payment }`
      // (`payments.service.ts`) — this used to return the bare bill row,
      // which has no `payment` at all, so `result.payment.netPaise` in
      // `bills/page.tsx` threw the moment anyone actually accepted a bill
      // through the mock. Never caught before because no working e2e test
      // had ever driven this far into the flow.
      const payment = {
        id: `pay-${Date.now()}`,
        tripId: bill.tripId,
        kind: 'BALANCE' as const,
        grossPaise: netPaise,
        penaltyPaise: 0,
        netPaise,
        tdsPaise: 0,
        releasedBy: USERS[role].name,
        releasedAt: helpers.now(),
        utr: body.utr,
      };
      return ok({ id: bill.id, status: bill.status, payment });
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
      // `invoices/new/page.tsx` deliberately never sends `roundOffPaise` or
      // `totalPaise` — its own comment says the server computes both from
      // the heads (NFR-09) and refuses a body that carries them. This mock
      // used to just spread `...body` and stop, so neither field was ever
      // set at all: not zero, genuinely `undefined`, which is why the
      // printed invoice's Total row rendered blank rather than ₹0. Computed
      // here the same way the form previews it, minus the discount head.
      const freightPaise = body.freightPaise ?? 0;
      const extrasPaise =
        (body.loadingPaise ?? 0) + (body.unloadingPaise ?? 0) + (body.detentionPaise ?? 0) + (body.otherPaise ?? 0) -
        (body.discountPaise ?? 0);
      const subtotalPaise = freightPaise + extrasPaise;
      const roundOffPaise = Math.round(subtotalPaise / 100) * 100 - subtotalPaise;
      const invoice = {
        id: `inv-${db.invoices.length + 500}`,
        code: null,
        status: 'DRAFT',
        receivedPaise: 0,
        taxMechanism: 'REVERSE_CHARGE',
        cancelReason: null,
        clientName: db.clients.find((c) => c.id === body.clientId)?.name ?? '—',
        ...body,
        roundOffPaise,
        totalPaise: subtotalPaise + roundOffPaise,
      };
      db.invoices.unshift(invoice);
      return ok(invoice);
    },
  ],
  [
    'PATCH',
    /^\/invoices\/([^/]+)$/,
    ({ params, body }) => {
      // Mirrors `internal-api`'s `InvoicingService.update()` — same two
      // invariants: a receipted invoice is locked (cancel and reissue
      // instead), and an issued invoice's trip selection is locked (only a
      // draft's `tripIds` — never marked `billed` yet — is free to change).
      const invoice = findInvoice(params[0]);
      if (invoice.status === 'CANCELLED') fail(409, 'ALREADY_CANCELLED', 'This invoice has already been cancelled.');
      if (invoice.receivedPaise > 0)
        fail(
          409,
          'INVOICE_HAS_RECEIPTS',
          'A receipt has already been recorded against this invoice. Cancel and raise a new one instead of editing it.',
        );

      const isDraft = invoice.status === 'DRAFT';
      const currentTripIds: string[] = invoice.tripIds ?? [];
      let tripIds = currentTripIds;
      let freightPaise = invoice.freightPaise;

      if (body.tripIds) {
        const same =
          body.tripIds.length === currentTripIds.length &&
          body.tripIds.every((t: string) => currentTripIds.includes(t));
        if (!same) {
          if (!isDraft)
            fail(
              409,
              'INVOICE_LOCKED',
              'The consignments on an issued invoice can’t be changed. Cancel this one and raise a new one instead.',
            );
          if (body.freightPaise === undefined)
            fail(400, 'VALIDATION_ERROR', 'freightPaise is required when the selected consignments change.');
          for (const tripId of body.tripIds) {
            const trip = db.trips.find((t) => t.id === tripId);
            if (!trip) fail(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
            if (!['IN_TRANSIT', 'DELIVERED', 'CLOSED'].includes(trip.stage))
              fail(409, 'TRIP_NOT_ON_ROAD', `Trip ${trip.code} has not left the loading point yet.`);
            if (trip.billed && !currentTripIds.includes(tripId))
              fail(409, 'TRIP_ALREADY_BILLED', `Trip ${trip.code} is already on another invoice.`);
          }
          tripIds = body.tripIds;
          freightPaise = body.freightPaise;
        }
      }

      const loadingPaise = body.loadingPaise ?? invoice.loadingPaise ?? 0;
      const unloadingPaise = body.unloadingPaise ?? invoice.unloadingPaise ?? 0;
      const detentionPaise = body.detentionPaise ?? invoice.detentionPaise ?? 0;
      const otherPaise = body.otherPaise ?? invoice.otherPaise ?? 0;
      const discountPaise = body.discountPaise ?? invoice.discountPaise ?? 0;
      const subtotalPaise = freightPaise + loadingPaise + unloadingPaise + detentionPaise + otherPaise - discountPaise;
      const roundOffPaise = Math.round(subtotalPaise / 100) * 100 - subtotalPaise;

      Object.assign(invoice, {
        clientId: isDraft && body.clientId ? body.clientId : invoice.clientId,
        clientName:
          isDraft && body.clientId
            ? (db.clients.find((c) => c.id === body.clientId)?.name ?? invoice.clientName)
            : invoice.clientName,
        invoiceDate: body.invoiceDate ?? invoice.invoiceDate,
        dueDate: body.dueDate ?? invoice.dueDate,
        tripIds,
        freightPaise,
        loadingPaise,
        unloadingPaise,
        detentionPaise,
        otherPaise,
        discountPaise,
        roundOffPaise,
        totalPaise: subtotalPaise + roundOffPaise,
        notes: body.notes ?? invoice.notes,
      });
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
        if (trip) {
          trip.billed = true;
          // Billing the client closes a trip whose transporter has already been paid.
          if (trip.balancePaidPaise > 0) trip.stage = 'CLOSED';
        }
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
      // The same rule that stops an indent: no pricing work for a client Compliance has not cleared.
      const forClient = db.clients.find((c) => c.id === body.clientId) ?? fail(404, 'NOT_FOUND', 'That client does not exist.');
      if (forClient.status !== 'ACTIVE')
        fail(422, 'CLIENT_NOT_CLEARED', 'This client has not been cleared by Compliance yet, so no rate request can be built for them.');
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
    ({ params, body, branch }) => {
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
    ({ role, branch }) => {
      const indents = scopeBranch(db.indents, branch);
      const open = indents.filter((i) => i.stage === 'OPEN');
      const failures = indents.filter(
        (i) => ['OPEN', 'VENDOR_ASSIGNED'].includes(i.stage) && new Date(i.pickupDate).getTime() < Date.now(),
      );
      const trips = scopeBranch(db.trips, branch);
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
    ({ role, branch }) => {
      const trips = scopeBranch(db.trips, branch);
      const demo = isDemoData();
      const live = liveStats(trips);
      const branchRows = (demo ? [
        { branchName: 'Nashik', trips: 412, revenuePaise: 1864000000, costPaise: 1598000000 },
        { branchName: 'Pune', trips: 388, revenuePaise: 1721000000, costPaise: 1483000000 },
        { branchName: 'Vijayawada', trips: 301, revenuePaise: 1394000000, costPaise: 1226000000 },
        { branchName: 'Gandhidham', trips: 266, revenuePaise: 1538000000, costPaise: 1371000000 },
        { branchName: 'Hosur', trips: 194, revenuePaise: 987000000, costPaise: 872000000 },
      ] : branchRowsFor(trips)).filter((b) => !scopedBranch(branch) || b.branchName === scopedBranch(branch)!.name);
      const revenuePaise = branchRows.reduce((a, b) => a + b.revenuePaise, 0);
      const costPaise = branchRows.reduce((a, b) => a + b.costPaise, 0);
      return ok({
        month: {
          trips: branchRows.reduce((a, b) => a + b.trips, 0),
          revenuePaise,
          costPaise,
          marginPaise: revenuePaise - costPaise,
          vendorsUsed: demo ? 38 : live.vendorsUsed,
          onTimePct: demo ? 91.4 : live.onTimePct,
          placedByPickup: demo ? 1489 : live.placedByPickup,
          failures: demo ? 72 : live.failures,
          distinctTrucks: demo ? 412 : live.distinctTrucks,
        },
        branches: branchRows,
        topClients: demo
          ? [
              { clientName: 'Berger Paints', revenuePaise: 2140000000 },
              { clientName: 'Apex Ceramics', revenuePaise: 1810000000 },
              { clientName: 'Sanghvi Metals', revenuePaise: 1290000000 },
            ]
          : live.topClients,
        pod: {
          delivered: demo ? 1488 : live.delivered,
          collected: demo ? 1351 : live.collected,
          pending: trips.filter((t) => !['APPROVED', 'WAIVED'].includes(t.podStatus)).length,
          withinTat: demo ? 1288 : live.withinTat,
          breached: demo ? 63 : live.breached,
          collectionPct: demo ? 90.8 : live.collectionPct,
          penaltyAccruedPaise: demo ? 630000 : live.penaltyAccruedPaise,
        },
        standing: {
          advanceOutstandingPaise: demo ? 18400000 : live.advanceOutstandingPaise,
          balancePendingPaise: demo ? 31700000 : live.balancePendingPaise,
          receivablesPaise: demo ? 145200000 : live.receivablesPaise,
          unbilledTrips: demo ? 41 : live.unbilledTrips,
        },
      });
    },
  ],
  [
    'GET',
    /^\/pnl$/,
    ({ role, branch }) => {
      const pnlTrips = scopeBranch(db.trips, branch);
      const chargeCost = (ts: any[], type: string) =>
        ts.reduce(
          (a, t) => a + (t.charges ?? []).filter((c: any) => c.chargeType === type).reduce((x: number, c: any) => x + (c.costAmountPaise ?? 0), 0),
          0,
        );
      const rows = (isDemoData() ? [
        { period: 'Nashik', placementPaise: 1418000000, loadingPaise: 92000000, unloadingPaise: 61000000, detentionPaise: 21000000, otherPaise: 6000000, revenuePaise: 1864000000 },
        { period: 'Pune', placementPaise: 1329000000, loadingPaise: 82000000, unloadingPaise: 54000000, detentionPaise: 14000000, otherPaise: 4000000, revenuePaise: 1721000000 },
        { period: 'Vijayawada', placementPaise: 1104000000, loadingPaise: 71000000, unloadingPaise: 39000000, detentionPaise: 9000000, otherPaise: 3000000, revenuePaise: 1394000000 },
        { period: 'Gandhidham', placementPaise: 1241000000, loadingPaise: 79000000, unloadingPaise: 41000000, detentionPaise: 8000000, otherPaise: 2000000, revenuePaise: 1538000000 },
        { period: 'Hosur', placementPaise: 781000000, loadingPaise: 54000000, unloadingPaise: 29000000, detentionPaise: 6000000, otherPaise: 2000000, revenuePaise: 987000000 },
      ] : BRANCHES.map((b) => {
        const own = pnlTrips.filter((t) => t.branchId === b.id);
        return {
          period: b.name,
          placementPaise: own.reduce((a, t) => a + (t.buyRatePaise ?? 0), 0),
          loadingPaise: chargeCost(own, 'LOADING'),
          unloadingPaise: chargeCost(own, 'UNLOADING'),
          detentionPaise: chargeCost(own, 'DETENTION'),
          otherPaise: chargeCost(own, 'OTHER') + chargeCost(own, 'HALT') + chargeCost(own, 'LABOUR'),
          revenuePaise: own.reduce((a, t) => a + (t.sellRatePaise ?? 0), 0),
          hasTrips: own.length > 0,
        };
      }).filter((r) => r.hasTrips)).filter((r) => !scopedBranch(branch) || r.period === scopedBranch(branch)!.name);
      return ok({
        scope: scopedBranch(branch)
          ? `${scopedBranch(branch)!.name} only · pnl.view_all not granted`
          : 'All branches',
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
    ({ role, branch }) =>
      ok(
        scopeBranch(db.trips, branch)
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
  /*
   * `GET /telematics/vehicles/:vehicleNo` — the trip page's tracking panel.
   *
   * The backend has served this since the fleet board shipped
   * (`telematics.controller.ts`), and `forVehicle()` returns **null** for a
   * vehicle that is not on an open trip rather than 404ing — which is why the
   * portal types it `VehicleRow | null`. Without this handler the adapter
   * threw "No fixture for GET ...", so opening any trip in mock mode raised an
   * uncaught error. Returning null here, not `fail(404)`, is what mirrors the
   * real route.
   */
  [
    'GET',
    /^\/telematics\/vehicles\/([^/]+)$/,
    ({ params }) => {
      const vehicleNo = decodeURIComponent(params[0]);
      return ok(db.telematics.find((v: any) => v.vehicleNo === vehicleNo) ?? null);
    },
  ],
  [
    'PATCH',
    /^\/telematics\/vehicles\/([^/]+)$/,
    ({ params, body, role }) => {
      const vehicleNo = decodeURIComponent(params[0]);
      const row = db.telematics.find((v: any) => v.vehicleNo === vehicleNo) ??
        fail(404, 'NOT_FOUND', 'Vehicle not tracked.');
      Object.assign(row, body, {
        lastPingAt: helpers.now(),
        lastUpdatedBy: `${USERS[role].name} · manual`,
      });
      return ok(row);
    },
  ],

  /* ------------------------------------------------------------ C11 ----- */
  ['GET', /^\/admin\/import\/history$/, () => ok(db.importBatches)],
  [
    'POST',
    /^\/admin\/import\/([^/]+)\/commit$/,
    ({ params, body }) => {
      const batch = db.importBatches.find((b) => b.id === body?.batchId) ?? fail(404, 'NOT_FOUND', 'Batch not found');

      // These three refusals mirror `ImportService.commit` exactly. Without
      // them this adapter is more permissive than the thing it stands in for,
      // and the opening-balance case is the one that bites: a demo would show
      // a balance import committing cleanly when the real backend refuses it.
      if (batch.status === 'COMMITTED') {
        fail(409, 'ALREADY_COMMITTED', 'This batch has already been committed.');
      }
      if (batch.status === 'ABORTED') {
        fail(
          409,
          'IMPORT_ABORTED',
          'This file did not reconcile at dry run and cannot be committed. Correct it and upload again.',
        );
      }
      if (params[0] === 'opening-balances') {
        fail(
          501,
          'IMPORT_SET_NOT_WRITABLE',
          'Opening balances validate and reconcile, but committing them needs a file format that carries the ' +
            'fields an advance, an unbilled trip and an invoice each require. That format is not yet specified.',
        );
      }

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
  // Mirrors the real backend: the role is a claim on the signed-in token and
  // nothing else — there is no `localStorage.role` to consult any more, and
  // no `X-Debug-Role` header either. The OPS fallback is only ever reached on
  // routes downstream of a session that already resolved; `/auth/session`
  // itself rejects an unreadable token outright rather than falling back.
  const result = readToken(localStorage.getItem('token'), 'access');
  return result.ok ? result.claims.role : 'OPS';
}

/**
 * The signed-in person's branch, from the token — `null` for all-branches.
 *
 * A token minted before `branch` joined the claims has it `undefined`; that
 * reads as unscoped, which is the safe direction: it shows too much rather
 * than silently hiding rows.
 */
/** The signed-in person's name — the branched account's own, not just the role's default person. */
function personName(userId: string, role: RoleCode): string {
  return ACCOUNTS.find((a) => a.userId === userId)?.name ?? USERS[role].name;
}

function currentUserId(): string {
  if (typeof window === 'undefined') return USERS.OPS.userId;
  const result = readToken(localStorage.getItem('token'), 'access');
  return result.ok ? result.claims.sub : USERS.OPS.userId;
}

function currentBranch(): string | null {
  if (typeof window === 'undefined') return null;
  const result = readToken(localStorage.getItem('token'), 'access');
  return result.ok ? (result.claims.branch ?? null) : null;
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
      // A handler may answer later — the upload one reads the file first.
      const result = await handler({
        params: match.slice(1),
        query,
        body,
        role: currentRole(),
        branch: currentBranch(),
        userId: currentUserId(),
        headers,
      });
      // Whatever this changed is kept, so the work survives a reload.
      if (method !== 'GET') persist(db as unknown as Record<string, any>, BRANCHES);
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

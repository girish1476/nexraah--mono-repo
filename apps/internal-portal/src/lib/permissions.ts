/**
 * Roles, permissions and the module matrix — presentation only.
 *
 * NFR-01: every one of these checks exists on the server as
 * `@UseGuards(SupabaseJwtGuard, PermissionsGuard) @RequirePermission(...)`.
 * Hiding a control here is presentation on top of a server rule, never
 * instead of one. The session payload from `GET /auth/session` carries the
 * authoritative permission list; the seeds below are the fallback used
 * before that call resolves, and they mirror part 01 §2.4.
 */

export const ROLE_CODES = [
  'OPS',
  'COMPLIANCE',
  'FINANCE',
  'BD',
  'LEADERSHIP',
  'ADMIN',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export type Level = 'NONE' | 'VIEW' | 'EDIT';

export interface RoleDef {
  code: RoleCode;
  label: string;
  landsOn: string;
  owns: string;
}

export const ROLES: Record<RoleCode, RoleDef> = {
  OPS: {
    code: 'OPS',
    label: 'Operations desk',
    landsOn: '/today',
    owns: 'Awards, placement, trip creation, LRs, transit, POD receive/verify/approve, branch margin',
  },
  COMPLIANCE: {
    code: 'COMPLIANCE',
    label: 'Compliance',
    landsOn: '/compliance',
    owns: 'Indent intake, vendor clearance, document verification and cross-check, contract approval, POD verify and approve',
  },
  FINANCE: {
    code: 'FINANCE',
    label: 'Finance',
    landsOn: '/payments/balance',
    owns: 'All payment release, invoicing, receipts, collections',
  },
  /**
   * Business development — the desk that wins the lane and sets what it is
   * worth. Added 2026-08-26 at the owner's direction, and deliberately the
   * only role whose subject is *price* rather than a stage of the shipment.
   *
   * It owns rate management end to end: building an RFQ lane's price, keeping
   * the client's rate card, and the client relationship the rate belongs to.
   * What it does not own is the moment a price becomes a commitment —
   * `rfq.submit` stays with Leadership, so the desk that proposes a rate is
   * never the desk that sends it to the client.
   */
  BD: {
    code: 'BD',
    label: 'Business development',
    landsOn: '/rfq',
    owns: 'Rate cards, RFQ pricing and lane build-up, client relationships',
  },
  LEADERSHIP: {
    code: 'LEADERSHIP',
    label: 'Leadership',
    landsOn: '/home',
    owns: 'Oversight of every desk, approvals, RFQ submission, reporting',
  },
  ADMIN: {
    code: 'ADMIN',
    label: 'Administrator',
    landsOn: '/admin',
    owns: 'Configuration, users, roles',
  },
};

/* ---- named permissions — part 01 §2.4 ---------------------------------- */

export const PERMISSIONS = [
  'payment.release',
  'indent.create',
  'indent.manage',
  'indent.view',
  'document.verify',
  'vendor.edit',
  'vendor.verify',
  'vendor.activate',
  'vendor.advance_policy',
  'client.manage',
  'client.onboard',
  'rate.revise',
  'audit.view',
  'ticket.resolve',
  'pod.receive',
  'pod.verify',
  'pod.approve',
  'pod.waive',
  'rfq.submit',
  'rfq.edit',
  'invoice.create',
  'receipt.record',
  'config.manage',
  'approve.above_band',
  'approve.waiver',
  'approve.exception',
  'approve.contract',
  'pnl.view_all',
  'pnl.view_own',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that may never be granted to a second role (BR-40, BR-43). */
export const FIXED_PERMISSIONS: Permission[] = [
  'payment.release',
  'pod.waive',
  'rfq.submit',
  'config.manage',
];

/** Freely attachable to any internal role (D-17, BR-41). */
export const GRANTABLE_ANYWHERE: Permission[] = ['indent.create', 'indent.manage', 'document.verify'];

export const SEED_GRANTS: Record<RoleCode, Permission[]> = {
  /**
   * Operations absorbed the branch manager in full. The two desks were never
   * separated by what they could do — only by how much they could see, and
   * that is now carried by the user's own branch rather than by their role.
   *
   * `approve.exception` came across with the rest. It is worth being explicit
   * about the cost, because the approvals registry still labels the three
   * kinds it governs — ADVANCE_OVERRIDE, ADVANCE_POLICY_CHANGE, DOC_OVERRIDE —
   * as "Senior to OPS". That label is no longer guaranteed: an operator can
   * now approve an exception another operator raised. Compliance and
   * Leadership still hold the permission, so a different desk *can* still
   * review; it is simply no longer forced. This was a product decision taken
   * with that trade-off on the table, not an oversight of it.
   *
   * `BR-50` is unaffected — the two-person POD rule keys on the acting user,
   * not the role, so one operator still cannot approve what they verified.
   */
  OPS: [
    'indent.create',
    'indent.manage',
    'indent.view',
    'vendor.edit',
    'rfq.edit',
    'pod.receive',
    'pod.verify',
    'pod.approve',
    'approve.exception',
    'pnl.view_own',
  ],
  COMPLIANCE: [
    'client.onboard',
    'indent.create',
    'indent.view',
    'document.verify',
    'vendor.verify',
    'vendor.activate',
    'vendor.advance_policy',
    'pod.receive',
    'pod.verify',
    'pod.approve',
    'pod.waive',
    'approve.contract',
    'approve.exception',
  ],
  FINANCE: [
    'payment.release',
    'invoice.create',
    'receipt.record',
    'client.manage',
    'rate.revise',
    'audit.view',
    'pnl.view_all',
    'indent.view',
  ],
  /**
   * Rate management, and nothing that spends money or moves a truck.
   *
   * `rfq.edit` builds the lane price, `client.manage` keeps the rate card it
   * lands on, and `pnl.view_own` is here because a desk that sets prices with
   * no sight of the margin they produce is guessing. `indent.view` lets them
   * see what the lane actually carried once it was won.
   *
   * Deliberately absent: `rfq.submit` — a fixed permission that stays with
   * Leadership, so the desk that proposes a price never also sends it to the
   * client. Also absent is every `approve.*`: BD raises an above-band price,
   * it does not approve one.
   */
  BD: ['rfq.edit', 'client.manage', 'indent.view', 'pnl.view_own'],
  /**
   * Leadership oversees every desk. As of 2026-08-26 that is literal rather
   * than nominal: they hold the operating permissions of Operations,
   * Compliance and Finance's document work, not merely a view of the screens.
   *
   * `payment.release` is still not here, and that is not an oversight. It sits
   * in FIXED_PERMISSIONS with `pod.waive` and `config.manage` — permissions
   * that never belong to two roles at once. Oversight of the money is a
   * different thing from being a second pair of hands that can move it, and
   * the audit trail is only worth reading while exactly one desk can pay.
   */
  LEADERSHIP: [
    'indent.create',
    'indent.manage',
    'indent.view',
    'document.verify',
    'vendor.edit',
    'vendor.verify',
    'vendor.activate',
    'vendor.advance_policy',
    'client.manage',
    'client.onboard',
    'rfq.edit',
    'rfq.submit',
    'pod.receive',
    'pod.verify',
    'pod.approve',
    'approve.above_band',
    'approve.waiver',
    'approve.exception',
    'approve.contract',
    'audit.view',
    'pnl.view_all',
  ],
  /**
   * Administrator sees and can act on every module — everything except the
   * three permissions in `FIXED_PERMISSIONS` besides `config.manage`, which
   * stay exclusive to Finance/Compliance/Leadership by design (BR-40, BR-43)
   * and are never granted to a second role, admin included. `approve.*` is
   * deliberately withheld too, so the approvals inbox stays what its own
   * copy says it is for admin: an audit view, never a decision.
   */
  ADMIN: [
    'config.manage',
    'indent.create',
    'indent.manage',
    'indent.view',
    'document.verify',
    'vendor.edit',
    'vendor.verify',
    'vendor.activate',
    'vendor.advance_policy',
    'client.manage',
    'client.onboard',
    'rate.revise',
    'pod.receive',
    'pod.verify',
    'pod.approve',
    'rfq.edit',
    'invoice.create',
    'receipt.record',
    'audit.view',
    'ticket.resolve',
    'pnl.view_all',
  ],
};

/* ---- module matrix — BR-29 --------------------------------------------- */

export type ModuleKey =
  | 'today'
  | 'home'
  | 'orders'
  | 'vendors'
  | 'compliance'
  | 'clients'
  | 'indents'
  | 'trips'
  | 'pod'
  | 'payments'
  | 'invoices'
  | 'receivables'
  | 'rfq'
  | 'telematics'
  | 'pnl'
  | 'approvals'
  | 'records'
  | 'search'
  | 'tickets'
  | 'admin';

const E: Level = 'EDIT';
const V: Level = 'VIEW';
const N: Level = 'NONE';

/**
 * Order: OPS · COMPLIANCE · FINANCE · LEADERSHIP · ADMIN.
 *
 * BRANCH_MGR is gone. Where it held more than OPS did — home, pod, payments,
 * invoices, receivables, pnl, approvals — OPS was raised to the branch
 * manager's level rather than the other way round, so nobody lost a screen
 * they had this morning. Branch scoping moved to the user's own branch.
 *
 * ADMIN is EDIT on every module — the sidebar shows the full console and
 * every screen unlocks its controls. What ADMIN still can't do lives in
 * `SEED_GRANTS.ADMIN`, not here: the three permissions that never move to a
 * second role (BR-40, BR-43), plus the `approve.*` decisions, stay with
 * Finance/Compliance/Leadership so the module being unlocked never implies
 * the fixed actions on it are too.
 */
export const MODULE_ACCESS: Record<ModuleKey, Record<RoleCode, Level>> = {
  /**
   * Orders is a read-only lifecycle view composed client-side from indents,
   * trips and invoices — it has no mutating actions of its own, every one of
   * them happens on the underlying page it links out to. EDIT everywhere
   * simply means "can open it", so every role gets one place to see where a
   * shipment actually stands instead of piecing it together across screens.
   */
  orders: { OPS: E, COMPLIANCE: E, FINANCE: E, BD: E, LEADERSHIP: E, ADMIN: E },
  /** The third common segment. One box that finds anything, for everybody. */
  search: { OPS: E, COMPLIANCE: E, FINANCE: E, BD: E, LEADERSHIP: E, ADMIN: E },
  /**
   * Raising a ticket is open to every desk — the person who spots wrong data
   * is whoever was using the screen. Acting on one is gated separately by
   * `ticket.resolve`, which only Administration holds.
   */
  tickets: { OPS: E, COMPLIANCE: E, FINANCE: E, BD: E, LEADERSHIP: E, ADMIN: E },
  /*
   * My desk, Business snapshot and Global search are EDIT for every role at
   * the owner's direction — the three screens everybody starts from, common
   * to all six desks rather than varying by job. Finance was VIEW on `today`
   * and Compliance VIEW on `home`, which meant two desks landed on a screen
   * they could read and not work.
   */
  today: { OPS: E, COMPLIANCE: E, FINANCE: E, BD: E, LEADERSHIP: E, ADMIN: E },
  home: { OPS: E, COMPLIANCE: E, FINANCE: E, BD: E, LEADERSHIP: E, ADMIN: E },
  /**
   * Operations owns vendor onboarding — it is the desk that actually brings a
   * transporter in and collects their papers. Compliance still owns the
   * *clearance* decision: `vendor.verify` and `vendor.activate` are not in
   * SEED_GRANTS.OPS, so an operator can open and fill a vendor record but
   * cannot pass it themselves.
   */
  vendors: { OPS: E, COMPLIANCE: E, FINANCE: V, BD: V, LEADERSHIP: E, ADMIN: E },
  /**
   * Leadership was `NONE` here until 2026-08-26 — the compliance queue was the
   * one screen in the console they could not open at all, which sat oddly with
   * a role whose job is oversight. It is now EDIT at the owner's direction:
   * they can verify documents and clear a vendor themselves, not only watch
   * the backlog.
   *
   * The cost, stated plainly because it is a real one: vendor clearance no
   * longer *forces* two desks. Compliance normally does it, but Leadership can
   * now clear a vendor alone. `BR-50`'s two-person POD rule is unaffected — it
   * keys on the acting user rather than the role, so nobody approves what they
   * themselves verified, whatever role they hold.
   *
   * BD is `NONE`: rate work has no business in the document queue.
   */
  compliance: { OPS: N, COMPLIANCE: E, FINANCE: V, BD: N, LEADERSHIP: E, ADMIN: E },
  /**
   * Compliance runs client onboarding — bringing a client in, collecting
   * their papers and clearing them — so `clients` is EDIT for them, the same
   * way `vendors` is EDIT for the desk that onboards transporters. Finance
   * keeps `client.manage` and with it the commercial record; the two
   * permissions divide the module rather than competing for it.
   */
  clients: { OPS: V, COMPLIANCE: E, FINANCE: E, BD: E, LEADERSHIP: E, ADMIN: E },
  indents: { OPS: E, COMPLIANCE: E, FINANCE: V, BD: V, LEADERSHIP: E, ADMIN: E },
  trips: { OPS: E, COMPLIANCE: E, FINANCE: V, BD: V, LEADERSHIP: E, ADMIN: E },
  pod: { OPS: E, COMPLIANCE: E, FINANCE: V, BD: N, LEADERSHIP: E, ADMIN: E },
  /**
   * Compliance verifies the advance document checklist; Finance releases the
   * money. Both need the payments screens, so the module is EDIT for both —
   * but `payment.release` lives only in SEED_GRANTS.FINANCE and is a fixed
   * permission that never moves to a second role, so Compliance sees the gate
   * and clears documents against it without ever being able to pay.
   */
  /**
   * Leadership is EDIT here so they can work the advance and balance gates
   * alongside Compliance and Finance. They still cannot pay: `payment.release`
   * is a fixed permission and stays with Finance alone, so the screen unlocks
   * and the release button does not.
   *
   * BD is VIEW — a desk that prices lanes needs to see whether the money on
   * them actually moved, and nothing beyond that.
   */
  payments: { OPS: V, COMPLIANCE: E, FINANCE: E, BD: V, LEADERSHIP: E, ADMIN: E },
  invoices: { OPS: V, COMPLIANCE: N, FINANCE: E, BD: V, LEADERSHIP: E, ADMIN: E },
  receivables: { OPS: V, COMPLIANCE: N, FINANCE: E, BD: V, LEADERSHIP: E, ADMIN: E },
  /** BD's home screen — the lane price is built here. */
  rfq: { OPS: E, COMPLIANCE: V, FINANCE: V, BD: E, LEADERSHIP: E, ADMIN: E },
  telematics: { OPS: E, COMPLIANCE: V, FINANCE: N, BD: N, LEADERSHIP: E, ADMIN: E },
  pnl: { OPS: V, COMPLIANCE: N, FINANCE: E, BD: V, LEADERSHIP: E, ADMIN: E },
  approvals: { OPS: E, COMPLIANCE: E, FINANCE: E, BD: V, LEADERSHIP: E, ADMIN: E },
  /**
   * The audit trail. EDIT for the three desks that hold `audit.view`, for
   * the same reason `orders` is EDIT everywhere: the module level only
   * decides whether the screen can be opened, and a VIEW level would hide
   * the row from the sidebar entirely. Nothing on it mutates anything —
   * nothing CAN, the table refuses UPDATE and DELETE at the database.
   */
  records: { OPS: N, COMPLIANCE: N, FINANCE: E, BD: N, LEADERSHIP: E, ADMIN: E },
  admin: { OPS: N, COMPLIANCE: N, FINANCE: N, BD: N, LEADERSHIP: V, ADMIN: E },
};

export const MODULE_LABEL: Record<ModuleKey, string> = {
  today: 'My desk',
  home: 'Business snapshot',
  orders: 'Orders',
  vendors: 'Transporters',
  compliance: 'Document checks',
  clients: 'Clients',
  indents: 'Load requests',
  trips: 'Trips on the road',
  pod: 'Delivery proof',
  payments: 'Payments to transporters',
  invoices: 'Client bills',
  receivables: 'Money to collect',
  rfq: 'Rate requests',
  telematics: 'Tracking',
  pnl: 'Profit & loss',
  approvals: 'Approvals',
  records: 'Record of what happened',
  search: 'Global search',
  tickets: 'Tickets',
  admin: 'Settings',
};

/**
 * One emoji per module, used as the console's recognition layer.
 *
 * The sixteen hand-drawn line icons this replaces were a nice piece of craft
 * and, at 16px in a sidebar, indistinguishable from each other — a column of
 * small grey shapes. An emoji is recognised before it is read, which is worth
 * more than stylistic consistency to a compliance clerk who opens this
 * console twice a day and was never trained on it.
 *
 * Always paired with the plain-language label, never load-bearing on its own:
 * a screen reader gets the word, and so does a monochrome print.
 */
export const MODULE_EMOJI: Record<ModuleKey, string> = {
  today: '🏠',
  home: '📊',
  orders: '📦',
  vendors: '🚛',
  compliance: '🛡️',
  clients: '🏢',
  indents: '📝',
  trips: '🛣️',
  pod: '📸',
  payments: '💸',
  invoices: '🧾',
  receivables: '📥',
  rfq: '💬',
  telematics: '📍',
  pnl: '📈',
  approvals: '✋',
  records: '🧭',
  search: '🔎',
  tickets: '🎫',
  admin: '🎛️',
};

/** Plain-language labels for raw permission keys, for use anywhere a permission is named in the UI. */
export const PERMISSION_LABEL: Record<Permission, string> = {
  'payment.release': 'Release payment',
  'indent.create': 'Raise indents',
  'indent.manage': 'Manage indents',
  'indent.view': 'View indents',
  'document.verify': 'Verify documents',
  'vendor.edit': 'Edit vendor records',
  'vendor.verify': 'Verify vendors',
  'vendor.activate': 'Activate vendors',
  'vendor.advance_policy': 'Set vendor advance policy',
  'client.manage': 'Create and edit client records',
  'client.onboard': 'Onboard and clear clients',
  // Who may *propose* a change to a price already agreed with a client. It
  // never applies one on its own — the change goes for sign-off to somebody
  // holding `approve.contract`, and no role holds both.
  'rate.revise': 'Change an agreed client rate',
  // Read the trail of who did what. There is no matching write or delete
  // permission, and there cannot be — the table refuses both at the
  // database, so this grants review and nothing else.
  'audit.view': 'Review the record of what everyone did',
  // Raising a ticket needs no permission — anyone who spots wrong data
  // can report it. This is the other half: acting on one, which means
  // correcting a record somebody else entered.
  'ticket.resolve': 'Act on reported data problems',
  'pod.receive': 'Receive proof of delivery',
  'pod.verify': 'Verify proof of delivery',
  'pod.approve': 'Approve proof of delivery',
  'pod.waive': 'Waive proof-of-delivery penalty',
  'rfq.submit': 'Submit quote requests',
  'rfq.edit': 'Edit quote requests',
  'invoice.create': 'Create invoices',
  'receipt.record': 'Record receipts',
  'config.manage': 'Manage configuration',
  'approve.above_band': 'Approve above-band exceptions',
  'approve.waiver': 'Approve waivers',
  'approve.exception': 'Approve exceptions',
  'approve.contract': 'Approve contracts',
  'pnl.view_all': 'View profit & loss (all branches)',
  'pnl.view_own': 'View profit & loss (own branch)',
};

/** Which module a route belongs to, longest prefix first. */
const ROUTE_MODULES: [string, ModuleKey][] = [
  ['/today', 'today'],
  ['/home', 'home'],
  ['/orders', 'orders'],
  ['/compliance', 'compliance'],
  ['/vendors', 'vendors'],
  ['/clients', 'clients'],
  ['/indents', 'indents'],
  ['/trips', 'trips'],
  ['/pod', 'pod'],
  ['/payments', 'payments'],
  ['/invoices', 'invoices'],
  ['/receivables', 'receivables'],
  ['/rfq', 'rfq'],
  ['/telematics', 'telematics'],
  ['/pnl', 'pnl'],
  ['/admin/approvals', 'approvals'],
  ['/records', 'records'],
  ['/search', 'search'],
  ['/tickets', 'tickets'],
  ['/admin', 'admin'],
];

export function moduleForPath(pathname: string): ModuleKey | null {
  const hit = [...ROUTE_MODULES]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

export function levelFor(module: ModuleKey, role: RoleCode): Level {
  return MODULE_ACCESS[module][role];
}

/* ---- navigation --------------------------------------------------------- */

/**
 * The console is divided into five places, each with one hue and one emoji.
 *
 * The old sidebar was six groups of database nouns — Vendors, Indents, POD,
 * RFQ, P&L — which is the shape of the schema, not the shape of anybody's
 * day. Twenty grey rows of jargon is why people said they could not find
 * things. These five areas are the shape of the business instead:
 *
 *   the desk you start at · the shipment · the people either side of it ·
 *   the money · the settings
 *
 * `area` picks up `--area-*` from globals.css. No module moved permission —
 * this is naming and grouping only, so `MODULE_ACCESS` is untouched.
 */
/**
 * Six places, not five. "Clients & supply" was one group holding both sides of
 * a load — the companies whose goods move and the transporters that move them
 * — which put twelve rows under one heading and asked the reader to sort them
 * out. They are separate desks doing separate work, so they are separate
 * areas.
 */
export type AreaKey = 'desk' | 'ship' | 'biz' | 'supply' | 'money' | 'control';

export interface NavItem {
  label: string;
  href: string;
  module: ModuleKey;
  /** The emoji for this row. Defaults to the module's, but a module with two
   *  rows (Delivery proof: collect vs verify) needs to tell them apart. */
  emoji?: string;
  /** One plain-language line for the quick-link cards on the desk. */
  note?: string;
  /**
   * A row that starts something — "Add a transporter", "Raise a load
   * request" — is only useful to a person who holds the permission the page
   * behind it checks. Module level alone can't say that: Compliance holds
   * EDIT on Transporters (to verify and activate) but not `vendor.edit`, so
   * the wizard would be a dead end for them. When set, `navFor` drops the
   * row for anyone without this permission — the same rule the page's own
   * button applies, so the sidebar never advertises a screen that will only
   * refuse.
   */
  permission?: Permission;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  area?: AreaKey;
  emoji?: string;
}

/**
 * Six areas, rebuilt 2026-09-02 to the owner's marked-up console.
 *
 * What changed and why, since every one of these was a specific instruction:
 *
 *  - **"All shipments" is now "Global search", and it moved to the top.** It
 *    was a per-area row for finding one load; it is the box you use to find
 *    anything, so it belongs beside My desk rather than inside Orders.
 *  - **My desk · Business snapshot · Global search are common to every role.**
 *    Same three rows, same place, whichever desk you are on.
 *  - **"The shipment" is now "Orders"**, and it carries the delivery-proof
 *    queues split the way the work actually splits: what is outstanding, what
 *    has blown its window, and what is sitting as a photo with no paper.
 *  - **"Clients & supply" became two areas.** Twelve rows under one heading
 *    asked the reader to sort demand from supply themselves.
 *  - **"Money" is now "Payments"** and **"Live vehicle tracking" is
 *    "Tracking"** — both plainer, both what people already call them.
 *  - **"Raise a load request" is gone.** Load requests already carries its own
 *    "Raise an indent" button, so the sidebar row was a second door to one
 *    room.
 *  - **"Trips on the road" is gone.** Its whole job was finding a trip, which
 *    Global search now does across every record at once.
 */
export const NAV: NavGroup[] = [
  {
    label: '',
    area: 'desk',
    items: [
      {
        label: 'My desk',
        href: '/today',
        module: 'today',
        emoji: '🏠',
        note: 'Everything waiting on you today',
      },
      {
        label: 'Business snapshot',
        href: '/home',
        module: 'home',
        emoji: '📊',
        note: 'How the month is going',
      },
      {
        label: 'Global search',
        href: '/search',
        module: 'search',
        emoji: '🔎',
        note: 'Find any load, trip, client, transporter or bill by one code',
      },
    ],
  },
  {
    label: 'Orders',
    area: 'ship',
    emoji: '🚚',
    items: [
      {
        label: 'Load requests',
        href: '/indents',
        module: 'indents',
        emoji: '📝',
        note: 'What clients have asked us to move',
      },
      {
        label: 'Tracking',
        href: '/telematics',
        module: 'telematics',
        emoji: '📍',
        note: 'Where the trucks are right now',
      },
      /*
       * Three delivery-proof rows where there were two, and they are cut by
       * what is wrong rather than by who acts. "Collect" and "Check" named the
       * desk's own verbs; these name the state of the paper, which is what
       * somebody arrives looking for.
       */
      {
        label: 'Delivery proof pending',
        href: '/pod/pending',
        module: 'pod',
        emoji: '🔍',
        note: 'Delivered loads whose signed paper has not reached us',
      },
      {
        /*
         * A preset of the row above, not a screen of its own. `/pod/pending`
         * already carries the ageing filter and the backend already accepts
         * `within | breached | forfeited`, so this needed a link rather than a
         * second copy of the same table. It pointed at `/pod/breached`, which
         * has no page — a dead row in the sidebar.
         */
        label: 'Delivery proof past due',
        href: '/pod/pending?ageing=breached',
        module: 'pod',
        emoji: '⏰',
        note: 'Past the agreed window — a penalty is running on these',
      },
      /*
       * An "E-POD pending" row belongs here and is deliberately absent until
       * it can work. It would list trips whose proof was photographed in the
       * transporter app but whose paper has not reached a branch — that is
       * `pod_status = 'ATTACHED'`, and nothing in the system ever writes that
       * value (the portal has no update grant on `trips` and derives it in the
       * response only). The row would therefore always be empty, which reads
       * as "nothing to chase" rather than "not built".
       *
       * Restore it once something persists ATTACHED. Same for a "Tickets" row:
       * `ticket.resolve` exists as a permission, but there is no tickets
       * endpoint, table or page behind it yet.
       */
    ],
  },
  {
    label: 'Clients',
    area: 'biz',
    emoji: '🏢',
    items: [
      {
        label: 'Clients',
        href: '/clients',
        module: 'clients',
        emoji: '🏢',
        note: 'Who we move goods for',
      },
      {
        label: 'Add a client',
        href: '/clients/new',
        module: 'clients',
        emoji: '🪪',
        note: 'Sign up a new client — company, agreement, credit terms',
        permission: 'client.manage',
      },
      {
        label: 'Client onboarding',
        href: '/clients/onboarding',
        module: 'clients',
        emoji: '📋',
        note: 'Check a new client’s papers before we carry for them',
        /*
         * Named, so the row follows the permission rather than the module.
         * `clients` is EDIT for Finance too — they own the commercial record
         * and the row above — but clearing a client is Compliance's decision,
         * and offering Finance a queue of decisions they cannot make is the
         * "menu of screens you can look at but not touch" this filter exists
         * to prevent.
         */
        permission: 'client.onboard',
      },
      {
        label: 'Change an agreed rate',
        href: '/clients/rate-changes',
        module: 'clients',
        emoji: '⚖️',
        note: 'Move the price on a lane we have already agreed — with a reason and a sign-off',
        /*
         * Deliberately NOT offered to the desks that approve it — Compliance
         * and Leadership hold `approve.contract` and would otherwise be shown
         * a screen whose whole output lands back in their own inbox.
         */
        permission: 'rate.revise',
      },
      {
        label: 'Rate requests',
        href: '/rfq',
        module: 'rfq',
        emoji: '💬',
        note: 'Pricing a client has asked us to quote',
      },
      {
        label: 'New rate request',
        href: '/rfq/new',
        module: 'rfq',
        emoji: '📣',
        note: 'Start pricing a client’s lanes for a new period',
      },
    ],
  },
  {
    label: 'Supply',
    area: 'supply',
    emoji: '🚛',
    items: [
      {
        label: 'Transporters',
        href: '/vendors',
        module: 'vendors',
        emoji: '🚛',
        note: 'The fleet owners who carry the loads',
      },
      {
        label: 'Add a transporter',
        href: '/vendors/new',
        module: 'vendors',
        emoji: '➕',
        note: 'Bring a new fleet owner on — papers, fleet, bank details',
        permission: 'vendor.edit',
      },
      {
        label: 'Transporter leads',
        href: '/vendors/leads',
        module: 'vendors',
        emoji: '📇',
        note: 'Fleet owners we have met but not signed up yet',
      },
      {
        label: 'Lanes short of trucks',
        href: '/vendors/market-gap',
        module: 'vendors',
        emoji: '🧭',
        note: 'Routes where nobody quoted — recruit here',
      },
      {
        label: 'Problems with transporters',
        href: '/vendors/issues',
        module: 'vendors',
        emoji: '🛠️',
        note: 'Complaints and incidents logged against a transporter',
      },
      {
        label: 'Document checks',
        href: '/compliance',
        module: 'compliance',
        emoji: '🛡️',
        note: 'Papers to verify before work goes ahead',
      },
    ],
  },
  {
    label: 'Payments',
    area: 'money',
    emoji: '💳',
    items: [
      {
        label: 'Advance payments',
        href: '/payments/advance',
        module: 'payments',
        emoji: '⏩',
        note: 'Part-payment to a transporter up front',
      },
      {
        label: 'Final payments',
        href: '/payments/balance',
        module: 'payments',
        emoji: '🏁',
        note: 'The rest, once delivery is proven',
      },
      {
        label: 'Transporter bills',
        href: '/payments/bills',
        module: 'payments',
        emoji: '📋',
        note: 'Match what a transporter billed against what the trip earned',
      },
      {
        label: 'Client bills',
        href: '/invoices',
        module: 'invoices',
        emoji: '🧾',
        note: 'What we have invoiced clients for',
      },
      {
        label: 'Raise a client bill',
        href: '/invoices/new',
        module: 'invoices',
        emoji: '➕',
        note: 'Bill a client for trips that have been delivered',
        permission: 'invoice.create',
      },
      {
        label: 'Money to collect',
        href: '/receivables',
        module: 'receivables',
        emoji: '📥',
        note: 'Bills the client has not paid yet',
      },
      {
        label: 'Profit & loss',
        href: '/pnl',
        module: 'pnl',
        emoji: '📈',
        note: 'What we earned against what we spent',
      },
    ],
  },
  {
    label: 'Control',
    area: 'control',
    emoji: '⚙️',
    items: [
      {
        label: 'Approvals',
        href: '/admin/approvals',
        module: 'approvals',
        emoji: '✋',
        note: 'Decisions only you can sign off',
      },
      /*
       * A "Tickets" row belongs here — open to every desk, since the person who
       * spots wrong data is whoever was on the screen, with `ticket.resolve`
       * gating action on somebody else's. It is deliberately absent until it
       * can work: the permission exists, but there is no tickets endpoint, no
       * table and no page behind it, so the row was a dead link in the
       * sidebar of every role. Restore it with the page.
       */
      { label: 'Settings', href: '/admin', module: 'admin', emoji: '🎛️' },
      { label: 'Who can do what', href: '/admin/roles', module: 'admin', emoji: '👥' },
      { label: 'Branches', href: '/admin/branches', module: 'admin', emoji: '🏬' },
      {
        label: 'Record of what happened',
        href: '/records',
        module: 'records',
        emoji: '🧭',
        note: 'Every change anyone made, who made it, and when',
        permission: 'audit.view',
      },
      { label: 'Bulk upload', href: '/admin/import', module: 'admin', emoji: '⬆️' },
    ],
  },
];

/**
 * A module the role can't act on is absent from the sidebar — not just one
 * it lacks entirely (§2.2's minimum), but also one it only holds VIEW on.
 * The page itself stays reachable by direct URL in read-only form (a VIEW
 * level still renders, just with no mutating controls — the "action the
 * role lacks: control not rendered" pattern, separately enforced per page);
 * this only trims the sidebar down to what the signed-in role can actually
 * do, so a new user isn't staring at a full menu of screens they can look
 * at but not touch.
 */
/**
 * Which of the five areas a module belongs to — read off `NAV` rather than
 * kept as a second map, so a module can never end up filed in one place in
 * the sidebar and tinted as another on its own page.
 */
export function areaFor(module: ModuleKey): AreaKey {
  return NAV.find((g) => g.items.some((i) => i.module === module))?.area ?? 'desk';
}

/**
 * `permissions` is what the server actually granted this session; it falls
 * back to the role's seed grants so a caller that only knows the role still
 * gets the right answer. Both filters apply: the module must be EDIT for the
 * role, and a row that names a permission is kept only when it is held.
 */
export function navFor(role: RoleCode, permissions: readonly Permission[] = SEED_GRANTS[role]): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        levelFor(item.module, role) === 'EDIT' && (!item.permission || permissions.includes(item.permission)),
    ),
  })).filter((group) => group.items.length > 0);
}

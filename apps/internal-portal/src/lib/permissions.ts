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
  'BRANCH_MGR',
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
  branchScoped: boolean;
}

export const ROLES: Record<RoleCode, RoleDef> = {
  OPS: {
    code: 'OPS',
    label: 'Operations desk',
    landsOn: '/today',
    owns: 'Awards, placement, trip creation, LRs, transit',
    branchScoped: false,
  },
  COMPLIANCE: {
    code: 'COMPLIANCE',
    label: 'Compliance',
    landsOn: '/compliance',
    owns: 'Indent intake, vendor clearance, document verification and cross-check, contract approval, POD verify and approve',
    branchScoped: false,
  },
  FINANCE: {
    code: 'FINANCE',
    label: 'Finance',
    landsOn: '/payments/balance',
    owns: 'All payment release, invoicing, receipts, collections',
    branchScoped: false,
  },
  BRANCH_MGR: {
    code: 'BRANCH_MGR',
    label: 'Branch manager',
    landsOn: '/today',
    owns: 'Branch placement performance, margin, RFQ sourcing, POD receive/verify/approve',
    branchScoped: true,
  },
  LEADERSHIP: {
    code: 'LEADERSHIP',
    label: 'Leadership',
    landsOn: '/home',
    owns: 'Approvals, RFQ submission, reporting',
    branchScoped: false,
  },
  ADMIN: {
    code: 'ADMIN',
    label: 'Administrator',
    landsOn: '/admin',
    owns: 'Configuration, users, roles',
    branchScoped: false,
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
  OPS: ['indent.manage', 'indent.view', 'vendor.edit', 'rfq.edit'],
  COMPLIANCE: [
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
  FINANCE: ['payment.release', 'invoice.create', 'receipt.record', 'client.manage', 'pnl.view_all', 'indent.view'],
  BRANCH_MGR: [
    'indent.create',
    'indent.manage',
    'indent.view',
    'rfq.edit',
    'vendor.edit',
    'pod.receive',
    'pod.verify',
    'pod.approve',
    'approve.exception',
    'pnl.view_own',
  ],
  LEADERSHIP: [
    'indent.view',
    'rfq.submit',
    'approve.above_band',
    'approve.waiver',
    'approve.exception',
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
    'pod.receive',
    'pod.verify',
    'pod.approve',
    'rfq.edit',
    'invoice.create',
    'receipt.record',
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
  | 'admin';

const E: Level = 'EDIT';
const V: Level = 'VIEW';
const N: Level = 'NONE';

/**
 * Order: OPS · COMPLIANCE · FINANCE · BRANCH_MGR · LEADERSHIP · ADMIN.
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
  orders: { OPS: E, COMPLIANCE: E, FINANCE: E, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: E },
  today: { OPS: E, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: E },
  home: { OPS: V, COMPLIANCE: V, FINANCE: E, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: E },
  /**
   * Operations owns vendor onboarding — it is the desk that actually brings a
   * transporter in and collects their papers. Compliance still owns the
   * *clearance* decision: `vendor.verify` and `vendor.activate` are not in
   * SEED_GRANTS.OPS, so an operator can open and fill a vendor record but
   * cannot pass it themselves.
   */
  vendors: { OPS: E, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: E },
  compliance: { OPS: N, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: N, LEADERSHIP: N, ADMIN: E },
  clients: { OPS: V, COMPLIANCE: V, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: E },
  indents: { OPS: E, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: E },
  trips: { OPS: E, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: E },
  pod: { OPS: V, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: E },
  /**
   * Compliance verifies the advance document checklist; Finance releases the
   * money. Both need the payments screens, so the module is EDIT for both —
   * but `payment.release` lives only in SEED_GRANTS.FINANCE and is a fixed
   * permission that never moves to a second role, so Compliance sees the gate
   * and clears documents against it without ever being able to pay.
   */
  payments: { OPS: N, COMPLIANCE: E, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: E },
  invoices: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: E },
  receivables: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: E },
  rfq: { OPS: E, COMPLIANCE: V, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: E },
  telematics: { OPS: E, COMPLIANCE: V, FINANCE: N, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: E },
  pnl: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: E, ADMIN: E },
  approvals: { OPS: V, COMPLIANCE: E, FINANCE: E, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: E },
  admin: { OPS: N, COMPLIANCE: N, FINANCE: N, BRANCH_MGR: N, LEADERSHIP: V, ADMIN: E },
};

export const MODULE_LABEL: Record<ModuleKey, string> = {
  today: 'My desk',
  home: 'Business snapshot',
  orders: 'All shipments',
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
  telematics: 'Live vehicle tracking',
  pnl: 'Profit & loss',
  approvals: 'Approvals',
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
export type AreaKey = 'desk' | 'ship' | 'biz' | 'money' | 'control';

export interface NavItem {
  label: string;
  href: string;
  module: ModuleKey;
  /** The emoji for this row. Defaults to the module's, but a module with two
   *  rows (Delivery proof: collect vs verify) needs to tell them apart. */
  emoji?: string;
  /** One plain-language line for the quick-link cards on the desk. */
  note?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  area?: AreaKey;
  emoji?: string;
}

/**
 * Inside "The shipment", the items are in the order the ten steps actually
 * happen — load request, trip, tracking, collect proof, verify proof. A
 * person following a shipment down the sidebar is following it through its
 * life, which is the one ordering nobody has to be taught.
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
    ],
  },
  {
    label: 'The shipment',
    area: 'ship',
    emoji: '🚚',
    items: [
      {
        label: 'All shipments',
        href: '/orders',
        module: 'orders',
        emoji: '📦',
        note: 'Every load, and how far along it is',
      },
      {
        label: 'Load requests',
        href: '/indents',
        module: 'indents',
        emoji: '📝',
        note: 'What clients have asked us to move',
      },
      {
        label: 'Trips on the road',
        href: '/trips',
        module: 'trips',
        emoji: '🛣️',
        note: 'Vehicles booked and running',
      },
      {
        label: 'Live vehicle tracking',
        href: '/telematics',
        module: 'telematics',
        emoji: '📍',
        note: 'Where the trucks are right now',
      },
      {
        label: 'Collect delivery proof',
        href: '/pod/receiving',
        module: 'pod',
        emoji: '📸',
        note: 'Log the signed paperwork as it arrives',
      },
      {
        label: 'Check delivery proof',
        href: '/pod/pending',
        module: 'pod',
        emoji: '🔍',
        note: 'Approve it so the final payment can go out',
      },
    ],
  },
  {
    label: 'Clients & supply',
    area: 'biz',
    emoji: '🤝',
    items: [
      {
        label: 'Clients',
        href: '/clients',
        module: 'clients',
        emoji: '🏢',
        note: 'Who we move goods for',
      },
      {
        label: 'Rate requests',
        href: '/rfq',
        module: 'rfq',
        emoji: '💬',
        note: 'Pricing a client has asked us to quote',
      },
      {
        label: 'Transporters',
        href: '/vendors',
        module: 'vendors',
        emoji: '🚛',
        note: 'The fleet owners who carry the loads',
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
    label: 'Money',
    area: 'money',
    emoji: '💰',
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
        label: 'Client bills',
        href: '/invoices',
        module: 'invoices',
        emoji: '🧾',
        note: 'What we have invoiced clients for',
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
      { label: 'Settings', href: '/admin', module: 'admin', emoji: '🎛️' },
      { label: 'Who can do what', href: '/admin/roles', module: 'admin', emoji: '👥' },
      { label: 'Branches', href: '/admin/branches', module: 'admin', emoji: '🏬' },
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

export function navFor(role: RoleCode): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => levelFor(item.module, role) === 'EDIT'),
  })).filter((group) => group.items.length > 0);
}

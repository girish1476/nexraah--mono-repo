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
    owns: 'Indents, awards, placement, LRs, transit',
    branchScoped: false,
  },
  COMPLIANCE: {
    code: 'COMPLIANCE',
    label: 'Compliance',
    landsOn: '/compliance',
    owns: 'Vendor clearance, document verification, contract approval, POD verify and approve',
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
  'indent.view',
  'document.verify',
  'vendor.edit',
  'vendor.verify',
  'vendor.activate',
  'vendor.advance_policy',
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
export const GRANTABLE_ANYWHERE: Permission[] = ['indent.create', 'document.verify'];

export const SEED_GRANTS: Record<RoleCode, Permission[]> = {
  OPS: ['indent.create', 'indent.view', 'document.verify', 'vendor.edit', 'rfq.edit'],
  COMPLIANCE: [
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
  FINANCE: ['payment.release', 'invoice.create', 'receipt.record', 'pnl.view_all', 'indent.view'],
  BRANCH_MGR: [
    'indent.create',
    'indent.view',
    'rfq.edit',
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
  ADMIN: ['config.manage'],
};

/* ---- module matrix — BR-29 --------------------------------------------- */

export type ModuleKey =
  | 'today'
  | 'home'
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

/** Order: OPS · COMPLIANCE · FINANCE · BRANCH_MGR · LEADERSHIP · ADMIN. */
export const MODULE_ACCESS: Record<ModuleKey, Record<RoleCode, Level>> = {
  today: { OPS: E, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: N },
  home: { OPS: V, COMPLIANCE: V, FINANCE: E, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: N },
  vendors: { OPS: V, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: V },
  compliance: { OPS: N, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: N, LEADERSHIP: N, ADMIN: N },
  clients: { OPS: V, COMPLIANCE: V, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: N },
  indents: { OPS: E, COMPLIANCE: V, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: N },
  trips: { OPS: E, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: N },
  pod: { OPS: V, COMPLIANCE: E, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: N },
  payments: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: N },
  invoices: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: N },
  receivables: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: V, ADMIN: N },
  rfq: { OPS: E, COMPLIANCE: V, FINANCE: V, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: N },
  telematics: { OPS: E, COMPLIANCE: V, FINANCE: N, BRANCH_MGR: E, LEADERSHIP: V, ADMIN: N },
  pnl: { OPS: N, COMPLIANCE: N, FINANCE: E, BRANCH_MGR: V, LEADERSHIP: E, ADMIN: N },
  approvals: { OPS: V, COMPLIANCE: E, FINANCE: E, BRANCH_MGR: E, LEADERSHIP: E, ADMIN: V },
  admin: { OPS: N, COMPLIANCE: N, FINANCE: N, BRANCH_MGR: N, LEADERSHIP: V, ADMIN: E },
};

export const MODULE_LABEL: Record<ModuleKey, string> = {
  today: 'Today',
  home: 'Home',
  vendors: 'Vendors',
  compliance: 'Compliance desk',
  clients: 'Clients',
  indents: 'Indents',
  trips: 'Trips',
  pod: 'Proof of delivery',
  payments: 'Payments',
  invoices: 'Invoicing',
  receivables: 'Receivables',
  rfq: 'RFQ',
  telematics: 'Telematics',
  pnl: 'P&L',
  approvals: 'Approvals inbox',
  admin: 'Control panel',
};

/** Which module a route belongs to, longest prefix first. */
const ROUTE_MODULES: [string, ModuleKey][] = [
  ['/today', 'today'],
  ['/home', 'home'],
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

export interface NavItem {
  label: string;
  href: string;
  module: ModuleKey;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: '',
    items: [
      { label: 'Today', href: '/today', module: 'today' },
      { label: 'Home', href: '/home', module: 'home' },
    ],
  },
  {
    label: 'Supply',
    items: [
      { label: 'Compliance desk', href: '/compliance', module: 'compliance' },
      { label: 'Vendors', href: '/vendors', module: 'vendors' },
      { label: 'Telematics', href: '/telematics', module: 'telematics' },
    ],
  },
  {
    label: 'Demand',
    items: [
      { label: 'Clients', href: '/clients', module: 'clients' },
      { label: 'RFQ', href: '/rfq', module: 'rfq' },
      { label: 'Indents', href: '/indents', module: 'indents' },
    ],
  },
  {
    label: 'Execution',
    items: [
      { label: 'Trips', href: '/trips', module: 'trips' },
      { label: 'POD receiving', href: '/pod/receiving', module: 'pod' },
      { label: 'POD pending', href: '/pod/pending', module: 'pod' },
    ],
  },
  {
    label: 'Money',
    items: [
      { label: 'Advance', href: '/payments/advance', module: 'payments' },
      { label: 'Balance', href: '/payments/balance', module: 'payments' },
      { label: 'Transporter bills', href: '/payments/bills', module: 'payments' },
      { label: 'Invoices', href: '/invoices', module: 'invoices' },
      { label: 'Receivables', href: '/receivables', module: 'receivables' },
      { label: 'P&L', href: '/pnl', module: 'pnl' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'Approvals', href: '/admin/approvals', module: 'approvals' },
      { label: 'Control panel', href: '/admin', module: 'admin' },
      { label: 'Roles matrix', href: '/admin/roles', module: 'admin' },
      { label: 'Import', href: '/admin/import', module: 'admin' },
    ],
  },
];

/** Modules a role lacks are absent from navigation, never greyed (§2.2). */
export function navFor(role: RoleCode): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => levelFor(item.module, role) !== 'NONE'),
  })).filter((group) => group.items.length > 0);
}

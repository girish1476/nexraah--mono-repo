/**
 * Mirrors `apps/internal-portal/src/lib/permissions.ts` — the authoritative
 * list per that file's own header and `20260814090400_c1_role_permissions_
 * and_config.sql` §1/§3. Used only for the `grants` half of `GET /admin/roles`
 * (part 01 §2.4: "what shipped seeded"); `matrix` is always read live from
 * `role_permissions`, and `permission_fixed_owners` (not this file) is what
 * `RolesService` enforces `409 PERMISSION_FIXED` against — see that
 * migration's §2 for why the fixed list is a DB table and not a second
 * hard-coded array here.
 */
export const INTERNAL_ROLES = [
  'OPS',
  'COMPLIANCE',
  'FINANCE',
  'BRANCH_MGR',
  'LEADERSHIP',
  'ADMIN',
] as const;

export type InternalRoleCode = (typeof INTERNAL_ROLES)[number];

export const SEED_GRANTS: Record<InternalRoleCode, string[]> = {
  OPS: ['indent.manage', 'indent.view', 'vendor.edit', 'rfq.edit'],
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
  FINANCE: ['payment.release', 'invoice.create', 'receipt.record', 'client.manage', 'pnl.view_all', 'indent.view'],
  BRANCH_MGR: [
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

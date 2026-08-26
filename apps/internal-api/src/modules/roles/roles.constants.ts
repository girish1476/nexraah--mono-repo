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
  'BD',
  'LEADERSHIP',
  'ADMIN',
] as const;

export type InternalRoleCode = (typeof INTERNAL_ROLES)[number];

export const SEED_GRANTS: Record<InternalRoleCode, string[]> = {
  // Operations absorbed the branch manager — see the portal's permissions.ts
  // for the full reasoning, including the deliberate cost of `approve.exception`
  // landing on the desk that raises exceptions.
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
  FINANCE: ['payment.release', 'invoice.create', 'receipt.record', 'client.manage', 'pnl.view_all', 'indent.view'],
  // Business development — rate management only. `rfq.submit` is deliberately
  // absent: it is a fixed permission held by Leadership, so the desk that
  // builds a price is never the desk that sends it to the client.
  BD: ['rfq.edit', 'client.manage', 'indent.view', 'pnl.view_own'],
  // Leadership oversees every desk in fact, not just on paper. `payment.release`
  // stays out — a fixed permission that never belongs to two roles, so
  // oversight of the money never becomes a second pair of hands on it.
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
    'pnl.view_all',
  ],
  ADMIN: ['config.manage'],
};

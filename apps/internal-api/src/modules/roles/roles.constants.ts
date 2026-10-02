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
  'LOADING_SUPERVISOR',
] as const;

export type InternalRoleCode = (typeof INTERNAL_ROLES)[number];

/**
 * The built-in roles a custom role may be based on. ADMIN is out because its
 * screens are only useful with `config.manage`, which is fixed to ADMIN; and
 * LOADING_SUPERVISOR is out because what it may do is decided per trip, by
 * assignment, not by anything a copy of the role would carry.
 */
export const CUSTOM_ROLE_BASES = ['OPS', 'COMPLIANCE', 'FINANCE', 'BD', 'LEADERSHIP'] as const;

export const SEED_GRANTS: Record<InternalRoleCode, string[]> = {
  // Holds no permission codes: a loading supervisor acts on the trips they are
  // assigned to, checked per trip in `TripsService`, not through a blanket grant.
  LOADING_SUPERVISOR: [],
  // Operations absorbed the branch manager — see the portal's permissions.ts
  // for the full reasoning, including the deliberate cost of `approve.exception`
  // landing on the desk that raises exceptions.
  OPS: [
    'indent.create',
    'indent.manage',
    'document.upload',
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
    'document.upload',
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
  // Business development — rate management only. `rfq.submit` is deliberately
  // absent: it is a fixed permission held by Leadership, so the desk that
  // builds a price is never the desk that sends it to the client.
  BD: ['rfq.edit', 'client.manage', 'indent.view', 'pnl.view_own', 'rate.revise'],
  // Leadership oversees every desk in fact, not just on paper. `payment.release`
  // stays out — a fixed permission that never belongs to two roles, so
  // oversight of the money never becomes a second pair of hands on it.
  LEADERSHIP: [
    'indent.create',
    'indent.manage',
    'indent.reassign',
    'indent.view',
    'document.upload',
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
  /*
   * Drifted from the portal's list until 2026-08-26: this file said
   * `['config.manage']` while `permissions.ts` — which this file's own header
   * names as authoritative — granted admin nineteen permissions, and the
   * migration seeded it that way too. `GET /admin/roles` reports `grants` from
   * here, so it was reporting an admin that could do one thing. Synced, and
   * `permissions-drift.test.ts` in the portal now fails if the two diverge
   * again.
   *
   * 2026-09-26: admin now holds every permission, by the owner's direction —
   * including the fixed `payment.release` / `pod.waive` / `rfq.submit` and all
   * four `approve.*`, which used to be withheld. See the portal's
   * permissions.ts for what that trades away. `permission_fixed_owners` is
   * unchanged: it only stops these being granted to *other* roles by PATCH.
   */
  ADMIN: [
    'payment.release',
    'pod.waive',
    'rfq.submit',
    'approve.above_band',
    'approve.waiver',
    'approve.exception',
    'approve.contract',
    'pnl.view_own',
    'config.manage',
    'indent.create',
    'indent.manage',
    'indent.reassign',
    'indent.view',
    'document.upload',
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

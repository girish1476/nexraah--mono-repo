import type { InternalRole } from '../../common/interfaces/authenticated-user.interface';
import type { DbExecutor } from '../../db/kysely';

export const APPROVAL_KINDS = [
  'ABOVE_BAND_PRICE',
  'ADVANCE_OVERRIDE',
  'ADVANCE_POLICY_CHANGE',
  'PENALTY_WAIVER',
  'DOC_OVERRIDE',
  'BRANCH_OVERRIDE',
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/**
 * Part 01 §3 names an approver ROLE per kind ("LEADERSHIP", "Senior to OPS");
 * `docs/api/01-foundation.md`'s `GET /approvals` needs a `requiredPermission`
 * CODE instead, for the sidebar badge and inbox routing. Only four `approve.*`
 * permissions actually exist (`approve.above_band`, `approve.waiver`,
 * `approve.exception`, `approve.contract` — `20260814090400_...sql` §1), not
 * one per kind, so the four "Senior to OPS" kinds share `approve.exception`.
 * `approve.contract` (COMPLIANCE's vendor-contract approval) maps to none of
 * the six — it isn't one of this engine's kinds.
 */
export const REQUIRED_PERMISSION_BY_KIND: Record<ApprovalKind, string> = {
  ABOVE_BAND_PRICE: 'approve.above_band',
  PENALTY_WAIVER: 'approve.waiver',
  ADVANCE_OVERRIDE: 'approve.exception',
  ADVANCE_POLICY_CHANGE: 'approve.exception',
  DOC_OVERRIDE: 'approve.exception',
  BRANCH_OVERRIDE: 'approve.exception',
};

/** Part 01 §3's literal approver column — a display label, not a permission check. */
export const APPROVER_ROLE_LABEL_BY_KIND: Record<ApprovalKind, string> = {
  ABOVE_BAND_PRICE: 'LEADERSHIP',
  ADVANCE_OVERRIDE: 'Senior to OPS',
  ADVANCE_POLICY_CHANGE: 'Senior to OPS',
  PENALTY_WAIVER: 'LEADERSHIP',
  DOC_OVERRIDE: 'Senior to OPS',
  BRANCH_OVERRIDE: 'LEADERSHIP',
};

/**
 * `approvals` has no `title`/`detail`/`amount_paise` columns — part 02 never
 * named them and no migration has added them. `docs/api/01-foundation.md`
 * `GET /approvals` documents them as "server-composed strings the inbox
 * renders verbatim", composed by the ORIGINATING action (which has the
 * domain context an approval-kind name alone doesn't), so they live inside
 * `approvals.payload` under this envelope rather than as bare columns.
 * `action` is the part "replayed verbatim" on approve (part 01 §3) — display
 * fields are never fed back into a handler.
 */
export interface ApprovalPayload<TAction = unknown> {
  title: string;
  detail: string;
  amountPaise: number | null;
  action: TAction;
}

/**
 * Registered by the wave that owns each kind's action (C4 for
 * `ABOVE_BAND_PRICE`, C7 for `ADVANCE_OVERRIDE`, …). `approve()` looks a
 * handler up by kind and invokes it with `payload.action`, inside the same
 * transaction that flips the approval row to `APPROVED` — so a handler that
 * throws rolls the decision back too.
 *
 * `context.db` IS that transaction (`ApprovalsService.approve()`'s own
 * `trx`) — a handler MUST run its writes through it, never open a second,
 * independent `this.xRepository.transaction()`. `approve()` holds `SELECT …
 * FOR UPDATE` on the `approvals` row for the whole call; a handler that opens
 * its own transaction gets its own connection from the same pool, and any
 * write it makes that references the locked row by foreign key (e.g.
 * `vendor_advance_history.approval_id`) blocks on that lock while `approve()`
 * is itself blocked awaiting the handler — a guaranteed self-deadlock, not a
 * rare one. Even where no FK forces a hang, a second transaction breaks the
 * "rolls back together" guarantee this type's own doc comment promises.
 *
 * `approverId`/`approverName` identify who is APPROVING right now, not the
 * original requester (`payload` / the approval row's `requester_id` already
 * carry that) — a handler that writes a history row (`vendor_advance_history`,
 * `trip_documents.verified_by`-shaped tables, …) needs the approver's
 * identity and has no other way to reach it.
 */
export type ApprovalHandler<TAction = unknown> = (
  action: TAction,
  context: {
    db: DbExecutor;
    approvalId: string;
    entityType: string;
    entityId: string;
    approverId: string;
    approverName: string;
    approverRole: InternalRole;
  },
) => Promise<void>;

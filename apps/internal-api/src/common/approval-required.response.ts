export interface ApprovalDto {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  title: string;
  detail: string;
  amountPaise: number | null;
  requesterId: string;
  requesterName: string;
  approverRole: string;
  requiredPermission: string;
  reason: string;
  status: string;
  createdAt: string;
}

/**
 * `00-conventions.md` §7 / part 01 §3: one of the six approval kinds fired
 * instead of completing directly. `202`, `success: true` — not an error.
 * A controller returns `new ApprovalRequiredResponse(approval)` from the same
 * handler that would otherwise return its normal 200/201 body;
 * `TransformInterceptor` recognises the wrapper, sets the status itself, and
 * emits `{ success: true, data: { approvalRequired: true, approval } }` — the
 * one place that shape gets built, so every future write endpoint across
 * C2–C11 that can trigger an approval reaches for this instead of
 * reimplementing the envelope.
 */
export class ApprovalRequiredResponse {
  constructor(public readonly approval: ApprovalDto) {}
}

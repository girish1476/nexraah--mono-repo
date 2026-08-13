import { Permission } from '@/lib/permissions';

export type ApprovalKind =
  | 'ABOVE_BAND_PRICE'
  | 'ADVANCE_OVERRIDE'
  | 'ADVANCE_POLICY_CHANGE'
  | 'PENALTY_WAIVER'
  | 'DOC_OVERRIDE'
  | 'BRANCH_OVERRIDE';

export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  entityType: 'indent' | 'trip' | 'vendor' | 'client';
  entityId: string;
  title: string;
  detail: string;
  amountPaise: number | null;
  requesterId: string;
  requesterName: string;
  approverRole: string;
  /** The permission a user must hold to decide this request. */
  requiredPermission: Permission;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  note?: string;
}

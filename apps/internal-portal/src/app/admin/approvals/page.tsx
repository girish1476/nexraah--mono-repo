'use client';

import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { errorMessage } from '@/apis';
import { fmtDateTime, inr } from '@/lib/format';
import { permissionsAtom, roleAtom } from '@/store/atoms';
import {
  Dialog,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Stack,
  Tag,
  Tone,
  useToast,
} from '@/lib/ui';
import { approve, listApprovals, reject } from './apis';
import { ApprovalRow } from './types';

const TONE: Record<string, Tone> = {
  ABOVE_BAND_PRICE: 'flag',
  ADVANCE_OVERRIDE: 'flag',
  ADVANCE_POLICY_CHANGE: 'blue',
  PENALTY_WAIVER: 'flag',
  DOC_OVERRIDE: 'red',
  BRANCH_OVERRIDE: 'blue',
};

const KIND_LABEL: Record<string, string> = {
  ABOVE_BAND_PRICE: 'Above-band award',
  ADVANCE_OVERRIDE: 'Advance override',
  ADVANCE_POLICY_CHANGE: 'Advance policy change',
  PENALTY_WAIVER: 'POD penalty waiver',
  DOC_OVERRIDE: 'Document override',
  BRANCH_OVERRIDE: 'Branch override',
};

/**
 * Approvals inbox — `/admin/approvals`.
 *
 * Six kinds of request, each raised by a `202 APPROVAL_REQUIRED` somewhere
 * else in the console. Approving replays the original payload; rejecting
 * requires a note.
 */
export default function ApprovalsPage() {
  const permissions = useAtomValue(permissionsAtom);
  const role = useAtomValue(roleAtom);
  const toast = useToast();

  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    listApprovals({ status: 'PENDING' })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const mine = (rows ?? []).filter((r) => permissions.includes(r.requiredPermission));

  const onApprove = async (row: ApprovalRow) => {
    setBusy(true);
    try {
      await approve(row.id);
      toast(`Approved · ${row.entityId} — the original action has been executed`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await reject(rejecting.id, note);
      toast(`Rejected · ${rejecting.entityId} — the requester has been notified`);
      setRejecting(null);
      setNote('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGuard module="approvals">
      <PageHeader
        path="/admin/approvals"
        title="Approvals inbox"
        sub="Requests waiting on a decision. Approving replays the original payload verbatim."
        module="approvals"
      />

      {error && <ErrorState message={error} retry={load} />}
      {!rows && !error && <Loading what="Loading approvals" />}

      {rows && (
        <Stack gap={12}>
          {mine.length === 0 && rows.length > 0 && (
            <div
              className="surface"
              style={{ borderLeft: '2px solid var(--color-accent)', padding: '11px 13px', fontSize: 12.5 }}
            >
              {role === 'OPS'
                ? 'You see requests you raised. Deciding them belongs to leadership and compliance.'
                : role === 'FINANCE'
                  ? 'Finance sees this queue for cash-flow visibility but approves none of it — approval and disbursement stay separate.'
                  : role === 'ADMIN'
                    ? 'Administrators see the queue as an audit view. Approving is not an administrator action.'
                    : 'Nothing here is yours to decide.'}
            </div>
          )}

          {rows.length === 0 && (
            <div className="surface muted" style={{ padding: 26, textAlign: 'center', fontSize: 13 }}>
              Nothing is waiting on a decision.
            </div>
          )}

          {rows.map((row) => {
            const canDecide = permissions.includes(row.requiredPermission);
            return (
              <div key={row.id} className="surface" style={{ padding: '14px 15px' }}>
                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 320px', minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <Tag tone={TONE[row.kind] ?? 'grey'}>{KIND_LABEL[row.kind] ?? row.kind}</Tag>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-accent-700)' }}>
                        {row.entityId}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 18, marginTop: 6 }}>
                      {row.title}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 3 }}>
                      {row.detail}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                      Raised by {row.requesterName} · {fmtDateTime(row.createdAt)}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3, fontStyle: 'italic' }}>
                      “{row.reason}”
                    </div>
                  </div>
                  <div
                    style={{
                      flex: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 8,
                      minWidth: 190,
                    }}
                  >
                    {row.amountPaise !== null && (
                      <div className="mono" style={{ fontSize: 19 }}>
                        {inr(row.amountPaise)}
                      </div>
                    )}
                    {canDecide ? (
                      <div style={{ display: 'flex', gap: 7 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setRejecting(row)} disabled={busy}>
                          Reject
                        </button>
                        <button className="btn btn-sm" onClick={() => onApprove(row)} disabled={busy}>
                          Approve
                        </button>
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: 11.5, textAlign: 'right', lineHeight: 1.4 }}>
                        Decided by {row.approverRole}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </Stack>
      )}

      <Dialog
        open={!!rejecting}
        title="Reject this request"
        body="A note is mandatory. The requester is notified with it, and it is written to the audit trail."
        confirmLabel="Reject"
        confirmDisabled={!note.trim()}
        busy={busy}
        onConfirm={onReject}
        onClose={() => {
          setRejecting(null);
          setNote('');
        }}
      >
        <Field label="Note to the requester" required>
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

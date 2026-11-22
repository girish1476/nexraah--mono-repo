'use client';

import { useState } from 'react';
import { errorMessage } from '@/apis';
import { dateLabel } from '@/lib/hr/calendar';
import { decideChange, decideCorrection, decideLeave } from '@/lib/hr/apis';
import type { PendingItem, ProfileChange } from '@/lib/hr/types';
import { Dialog, Field, useToast } from '@/lib/ui';
import { Avatar, DayPill, Empty } from './hr-ui';

/**
 * What is waiting for a decision — leave, attendance corrections, bank and
 * PAN changes — with Approve one tap away and Decline asking why.
 */
export function PendingList({
  items,
  changes = [],
  onDone,
  canDecideChanges = false,
  empty = 'Nothing waiting — all caught up.',
}: {
  items: PendingItem[];
  changes?: (ProfileChange & { employeeName: string })[];
  onDone: () => void;
  canDecideChanges?: boolean;
  empty?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PendingItem | null>(null);
  const [why, setWhy] = useState('');

  const decide = async (p: PendingItem, decision: 'APPROVE' | 'REJECT', note?: string) => {
    setBusy(p.id);
    try {
      if (p.kind === 'LEAVE') await decideLeave(p.id, decision, note);
      else await decideCorrection(p.id, decision, note);
      toast(`${decision === 'APPROVE' ? 'Approved' : 'Declined'} — ${p.employeeName.split(' ')[0]}’s ${p.kind === 'LEAVE' ? 'leave' : 'correction'}`);
      setDeclining(null);
      setWhy('');
      onDone();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const change = async (c: ProfileChange & { employeeName: string }, decision: 'APPROVE' | 'REJECT') => {
    setBusy(c.id);
    try {
      await decideChange(c.id, decision);
      toast(decision === 'APPROVE' ? `${c.employeeName.split(' ')[0]}’s ${c.field === 'bank' ? 'bank account' : 'PAN'} updated` : 'Change declined');
      onDone();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!items.length && !changes.length) return <Empty emoji="🎈">{empty}</Empty>;

  return (
    <>
      <div className="hr-list">
        {items.map((p) => (
          <div key={p.id} className="hr-row">
            <Avatar name={p.employeeName} size={36} />
            <div className="hr-row-main">
              <div style={{ fontWeight: 650 }}>
                {p.employeeName}{' '}
                <span className="hr-muted">
                  · {p.branchName} · asked {dateLabel(p.raisedAt)}
                </span>
              </div>
              <div style={{ marginTop: 2 }}>
                <DayPill status={p.kind === 'LEAVE' ? 'ON_LEAVE' : 'ON_DUTY'}>{p.title}</DayPill>
              </div>
              <div className="hr-muted" style={{ marginTop: 4 }}>
                {p.detail}
              </div>
            </div>
            <div className="hr-row-actions">
              <button className="btn btn-sm" disabled={busy === p.id} onClick={() => void decide(p, 'APPROVE')}>
                ✓ Approve
              </button>
              <button className="btn btn-secondary btn-sm" disabled={busy === p.id} onClick={() => setDeclining(p)}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {changes.map((c) => (
          <div key={c.id} className="hr-row">
            <Avatar name={c.employeeName} size={36} />
            <div className="hr-row-main">
              <div style={{ fontWeight: 650 }}>
                {c.employeeName} <span className="hr-muted">· asked {dateLabel(c.raisedAt)}</span>
              </div>
              <div style={{ marginTop: 2 }}>
                <DayPill status="LATE">{c.field === 'bank' ? 'New salary account' : 'PAN change'}</DayPill>
              </div>
              <div className="hr-muted" style={{ marginTop: 4 }}>
                {c.before ?? '—'} → <strong>{c.after}</strong>
                {c.bank ? ` · IFSC ${c.bank.ifsc}` : ''} — “{c.reason}”
              </div>
            </div>
            {canDecideChanges && (
              <div className="hr-row-actions">
                <button className="btn btn-sm" disabled={busy === c.id} onClick={() => void change(c, 'APPROVE')}>
                  ✓ Confirm
                </button>
                <button className="btn btn-secondary btn-sm" disabled={busy === c.id} onClick={() => void change(c, 'REJECT')}>
                  Decline
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Dialog
        open={!!declining}
        title={`Decline ${declining?.employeeName.split(' ')[0] ?? ''}’s request?`}
        body={declining ? `${declining.title} — ${declining.detail}` : undefined}
        confirmLabel="Decline"
        confirmDisabled={why.trim().length < 3}
        busy={!!busy}
        onConfirm={() => declining && void decide(declining, 'REJECT', why.trim())}
        onClose={() => {
          setDeclining(null);
          setWhy('');
        }}
      >
        <Field label="Tell them why" hint="They see this beside the request.">
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Month-end close that week — can we move it?" autoFocus />
        </Field>
      </Dialog>
    </>
  );
}

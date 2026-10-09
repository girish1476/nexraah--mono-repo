'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inr } from '@/lib/format';
import { Dialog, Field, FormGrid, Panel, Tag, useCan, useToast } from '@/lib/ui';
import { useAtomValue } from 'jotai';
import { roleAtom } from '@/store/atoms';
import { AddLaneDialog } from './add-lane-dialog';
import {
  correctRateLane,
  dismissRejectedRateLane,
  editPendingRateLane,
  getRejectedRateLanes,
  type RejectedRateLane,
} from './apis';
import { RATE_BASIS_LABEL, RateBasis, rateWithBasis } from './types';

/**
 * Putting a rate right.
 *
 * A rate typed wrongly could only be deleted (by Leadership or an
 * administrator) and entered again, and one that was turned down was simply
 * gone. Now an agreed rate is corrected in place, at once, with a reason; a
 * rate still waiting for sign-off is corrected where it waits; and one that was
 * turned down is kept, to be corrected and sent again.
 */

/** Who may correct rates: whoever proposes them, plus Leadership and administrators. */
export function useCanCorrectRates(): boolean {
  const can = useCan();
  const role = useAtomValue(roleAtom);
  return can('rate.revise') || role === 'LEADERSHIP' || role === 'ADMIN';
}

/** The parts of a lane that can be corrected. */
export interface LaneFacts {
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  rateBasis?: RateBasis;
  transitDays: number;
  validFrom: string;
  validTo?: string | null;
}

export type LaneEditTarget =
  | { mode: 'agreed'; laneId: string; lane: LaneFacts }
  | { mode: 'pending'; approvalId: string; lane: LaneFacts };

const MIN_REASON = 10;

export function EditLaneDialog({
  clientId,
  target,
  onClose,
  onSaved,
}: {
  clientId: string;
  target: LaneEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ rate: '', basis: 'FTL' as RateBasis, days: '', from: '', to: '', reason: '' });

  useEffect(() => {
    if (!target) return;
    const l = target.lane;
    setF({
      rate: String(l.ratePaise / 100),
      basis: l.rateBasis ?? 'FTL',
      days: String(l.transitDays),
      from: String(l.validFrom ?? '').slice(0, 10),
      to: l.validTo ? String(l.validTo).slice(0, 10) : '',
      reason: '',
    });
  }, [target]);

  const agreed = target?.mode === 'agreed';
  const paise = Math.round(Number(f.rate) * 100);
  const days = Number(f.days);
  const l = target?.lane;
  const unchanged =
    !!l &&
    paise === l.ratePaise &&
    f.basis === (l.rateBasis ?? 'FTL') &&
    days === l.transitDays &&
    f.from === String(l.validFrom ?? '').slice(0, 10) &&
    f.to === (l.validTo ? String(l.validTo).slice(0, 10) : '');
  const problem = !(paise > 0)
    ? 'Enter the lane rate.'
    : f.days.trim() === '' || !Number.isInteger(days) || days < 0 || days > 60
      ? 'Transit days should be a whole number of days.'
      : !f.from
        ? 'Say when the rate starts.'
        : f.to && f.to < f.from
          ? 'The rate cannot end before it starts.'
          : unchanged
            ? 'Nothing has been changed yet.'
            : agreed && f.reason.trim().length < MIN_REASON
              ? `Say why it is being corrected (at least ${MIN_REASON} characters).`
              : null;

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    const body = { ratePaise: paise, rateBasis: f.basis, transitDays: days, validFrom: f.from, validTo: f.to || null };
    try {
      if (target.mode === 'agreed') {
        await correctRateLane(clientId, target.laneId, { ...body, reason: f.reason.trim() });
        toast('Rate corrected — it applies from now');
      } else {
        await editPendingRateLane(clientId, target.approvalId, body);
        toast('Proposal corrected — it is still waiting for approval');
      }
      onClose();
      onSaved();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!target}
      title={agreed ? 'Edit the agreed rate' : 'Edit the proposed rate'}
      body={
        agreed
          ? 'For a rate that was typed wrongly. The correction applies at once to new load requests; loads already raised keep the freight they were raised at. The reason is kept on the rate.'
          : 'This rate is still waiting for approval. Correct it here and it stays in the approver’s inbox with the new figures.'
      }
      facts={l ? [['Lane', `${l.origin} → ${l.destination} · ${l.truckType}`], ['On record', rateWithBasis(inr(l.ratePaise), l.rateBasis)]] : undefined}
      confirmLabel="Save the rate"
      confirmDisabled={!!problem}
      busy={busy}
      onConfirm={submit}
      onClose={onClose}
    >
      <FormGrid>
        <Field label="Lane rate (₹)" required>
          <input type="number" min="0" value={f.rate} onChange={(e) => setF((p) => ({ ...p, rate: e.target.value }))} autoFocus />
        </Field>
        <Field label="Rate is">
          <select value={f.basis} onChange={(e) => setF((p) => ({ ...p, basis: e.target.value as RateBasis }))}>
            {(Object.keys(RATE_BASIS_LABEL) as RateBasis[]).map((b) => (
              <option key={b} value={b}>
                {RATE_BASIS_LABEL[b]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Transit days" required>
          <input type="number" min="0" max="60" value={f.days} onChange={(e) => setF((p) => ({ ...p, days: e.target.value }))} />
        </Field>
        <Field label="Valid from" required>
          <input type="date" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} />
        </Field>
        <Field label="Valid to" hint="Leave empty for an open-ended rate.">
          <input type="date" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} />
        </Field>
      </FormGrid>
      {agreed && (
        <FormGrid cols={1}>
          <Field label="Why it is being corrected" required hint="Kept on the rate.">
            <input value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} placeholder="e.g. Typed ₹6,420 instead of ₹64,200" />
          </Field>
        </FormGrid>
      )}
      {problem && (
        <div className="hint" role="status">
          {problem}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Lanes that were proposed and turned down — each with what the approver
 * wrote, and "Edit and send again", which opens the proposal with everything
 * already filled in so only the mistake needs changing.
 */
export function RejectedLanesPanel({
  clientId,
  clientName,
  refreshKey = 0,
  onResent,
}: {
  clientId: string;
  clientName: string;
  /** Bump to re-read after something on the rate card changed. */
  refreshKey?: number;
  onResent: () => void;
}) {
  const canCorrect = useCanCorrectRates();
  const toast = useToast();
  const [rows, setRows] = useState<RejectedRateLane[]>([]);
  const [again, setAgain] = useState<RejectedRateLane | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    getRejectedRateLanes(clientId)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [clientId, refreshKey, tick]);

  if (rows.length === 0) return null;

  return (
    <Panel title="↩️ Rates that were turned down">
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        These were not approved. Correct what was wrong and send it again — it goes back for approval with the new figures.
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.approvalId} data-rejected-lane={r.approvalId} className="surface" style={{ padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {r.origin} → {r.destination} · {r.truckType} · {rateWithBasis(inr(r.ratePaise), r.rateBasis)}
              </div>
              <div style={{ color: 'var(--red)', fontSize: 'var(--text-sm)', marginTop: 2 }}>Turned down: {r.note ?? 'no reason given'}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                Proposed by {r.requesterName}
                {r.rejectedAt ? ` · turned down ${fmtDate(r.rejectedAt)}` : ''}
              </div>
            </div>
            <Tag tone="red">Turned down</Tag>
            {canCorrect && (
              <>
                <button className="btn btn-sm" onClick={() => setAgain(r)}>
                  ✏️ Edit and send again
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await dismissRejectedRateLane(clientId, r.approvalId);
                      setTick((t) => t + 1);
                    } catch (e) {
                      toast(errorMessage(e));
                    }
                  }}
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <AddLaneDialog
        clientId={clientId}
        clientName={clientName}
        open={!!again}
        initial={
          again
            ? {
                origin: again.origin,
                destination: again.destination,
                truckType: again.truckType,
                ratePaise: again.ratePaise,
                rateBasis: again.rateBasis ?? 'FTL',
                transitDays: again.transitDays,
                validFrom: again.validFrom,
                validTo: again.validTo,
                reason: again.reason,
                approvalMailSubject: again.approvalMailSubject ?? '',
                transitPenaltyApplies: !!again.transitPenaltyApplies,
                transitPenaltyPerDayPaise: again.transitPenaltyPerDayPaise ?? 0,
              }
            : undefined
        }
        onClose={() => setAgain(null)}
        onSent={async () => {
          // The corrected proposal is in; the turned-down one stops being offered.
          if (again) await dismissRejectedRateLane(clientId, again.approvalId).catch(() => undefined);
          setAgain(null);
          setTick((t) => t + 1);
          onResent();
        }}
      />
    </Panel>
  );
}

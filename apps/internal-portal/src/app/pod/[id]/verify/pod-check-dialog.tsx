'use client';

import { useEffect, useState } from 'react';
import { DocPreview } from '@/components/doc-preview';
import { inr } from '@/lib/format';
import { Banner, Dialog, Field, FormGrid } from '@/lib/ui';
import { PodFindings } from '../../types';

/** The charges a delivery note usually carries, each with what it cost us and what the client is billed. */
const CHARGE_ROWS: { type: string; label: string }[] = [
  { type: 'DETENTION', label: 'Unloading detention' },
  { type: 'UNLOADING', label: 'Unloading charges' },
  { type: 'OTHER', label: 'Other charges' },
];

interface Finding {
  on: boolean;
  description: string;
  rupees: string;
}

interface Form {
  deliveredOn: string;
  receivedByName: string;
  quantityReceived: string;
  shortage: Finding;
  damage: Finding;
  charges: Record<string, { cost: string; billed: string }>;
  remarks: string;
}

const blank = (deliveredOn: string): Form => ({
  deliveredOn,
  receivedByName: '',
  quantityReceived: '',
  shortage: { on: false, description: '', rupees: '' },
  damage: { on: false, description: '', rupees: '' },
  charges: Object.fromEntries(CHARGE_ROWS.map((c) => [c.type, { cost: '', billed: '' }])),
  remarks: '',
});

const paise = (rupees: string) => Math.round((Number(rupees) || 0) * 100);
const DAY_MS = 86_400_000;

/**
 * Checking a proof of delivery — E-POD, H-POD, or the hard copy behind an
 * E-POD — the way every other document is checked: the scan on one side, the
 * details read off it typed in on the other.
 *
 * Beside the details it records what the check found: a shortage, a damage
 * (each becomes its own SDR and holds the balance), the charges written on the
 * note, and a corrected delivery date, which re-works the transit delay.
 */
export function PodCheckDialog({
  open,
  title,
  attachmentIds,
  deliveredAt,
  actualTransitDays,
  transitDaysRequired,
  transitPenaltyPaise,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  attachmentIds: string[];
  /** The delivery date on record (ISO). */
  deliveredAt: string | null;
  actualTransitDays?: number | null;
  transitDaysRequired?: number | null;
  transitPenaltyPaise?: number;
  busy: boolean;
  onConfirm: (findings: PodFindings) => void;
  onClose: () => void;
}) {
  const recordedDay = deliveredAt ? deliveredAt.slice(0, 10) : '';
  const [form, setForm] = useState<Form>(() => blank(recordedDay));
  // A fresh form each time it opens — nothing typed for one proof leaks into the next.
  useEffect(() => {
    if (open) setForm(blank(recordedDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setFinding = (key: 'shortage' | 'damage', value: Finding) => setForm((f) => ({ ...f, [key]: value }));
  const today = new Date().toISOString().slice(0, 10);

  // The transit delay as it will stand once the corrected date is saved.
  const dateChanged = !!form.deliveredOn && form.deliveredOn !== recordedDay;
  const shiftDays =
    dateChanged && recordedDay
      ? Math.round((new Date(form.deliveredOn).getTime() - new Date(recordedDay).getTime()) / DAY_MS)
      : 0;
  const transitDays = actualTransitDays != null ? Math.max(1, actualTransitDays + shiftDays) : null;
  const lateDays = transitDays != null && transitDaysRequired != null ? Math.max(0, transitDays - transitDaysRequired) : null;

  const problem = (() => {
    if (!form.deliveredOn) return 'Enter the delivery date written on the proof.';
    if (form.deliveredOn > today) return 'The delivery date cannot be in the future.';
    if (form.shortage.on && form.shortage.description.trim().length < 5) return 'Describe the shortage in a few words.';
    if (form.damage.on && form.damage.description.trim().length < 5) return 'Describe the damage in a few words.';
    return null;
  })();

  const confirm = () => {
    const findings: NonNullable<PodFindings['findings']> = [];
    if (form.shortage.on)
      findings.push({ kind: 'SHORTAGE', description: form.shortage.description.trim(), claimedAmountPaise: paise(form.shortage.rupees) });
    if (form.damage.on)
      findings.push({ kind: 'DAMAGE', description: form.damage.description.trim(), claimedAmountPaise: paise(form.damage.rupees) });
    const charges = CHARGE_ROWS.map((c) => ({
      chargeType: c.type,
      costAmountPaise: paise(form.charges[c.type].cost),
      billedAmountPaise: paise(form.charges[c.type].billed),
    })).filter((c) => c.costAmountPaise > 0 || c.billedAmountPaise > 0);
    onConfirm({
      details: {
        ...(form.receivedByName.trim() ? { receivedByName: form.receivedByName.trim() } : {}),
        ...(form.quantityReceived.trim() ? { quantityReceived: form.quantityReceived.trim() } : {}),
      },
      ...(dateChanged ? { deliveredOn: form.deliveredOn } : {}),
      ...(findings.length ? { findings } : {}),
      ...(charges.length ? { charges } : {}),
      ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
    });
  };

  const findingBlock = (key: 'shortage' | 'damage', label: string, hint: string) => {
    const value = form[key];
    return (
      <div className="pod-check-block">
        <label className="pod-check-toggle">
          <input type="checkbox" checked={value.on} onChange={(e) => setFinding(key, { ...value, on: e.target.checked })} />
          <strong>{label}</strong>
          <span className="muted">{hint}</span>
        </label>
        {value.on && (
          <FormGrid>
            <Field label="What is written on the proof" required>
              <input
                value={value.description}
                onChange={(e) => setFinding(key, { ...value, description: e.target.value })}
                placeholder={key === 'shortage' ? 'e.g. 4 bags short of 320' : 'e.g. 6 drums dented, 1 leaking'}
              />
            </Field>
            <Field label="Believed to cost (₹)" hint="Optional — the deduction is fixed when it is resolved.">
              <input
                type="number"
                min={0}
                value={value.rupees}
                onChange={(e) => setFinding(key, { ...value, rupees: e.target.value })}
              />
            </Field>
          </FormGrid>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      title={title}
      body="Check the document, then type its details from it. They are saved with the verification."
      confirmLabel="Verify"
      confirmDisabled={!!problem}
      busy={busy}
      onConfirm={confirm}
      onClose={onClose}
      width={880}
    >
      <div className="doc-check">
        <div style={{ display: 'grid', gap: 8 }}>
          {attachmentIds.length === 0 && <DocPreview attachmentId={null} label="Proof of delivery" width={170} height={210} />}
          {attachmentIds.map((id, i) => (
            <DocPreview key={id} attachmentId={id} label={`Proof of delivery, page ${i + 1}`} width={170} height={210} />
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Details on the proof</div>
          <FormGrid>
            <Field label="Delivered on" required hint="Correct it if the proof shows a different date.">
              <input type="date" max={today} value={form.deliveredOn} onChange={(e) => set({ deliveredOn: e.target.value })} />
            </Field>
            <Field label="Received by" hint="Name signed or stamped by the consignee.">
              <input value={form.receivedByName} onChange={(e) => set({ receivedByName: e.target.value })} />
            </Field>
            <Field label="Quantity received" hint="As written on the proof.">
              <input
                value={form.quantityReceived}
                onChange={(e) => set({ quantityReceived: e.target.value })}
                placeholder="e.g. 320 bags / 15 MT"
              />
            </Field>
          </FormGrid>

          <div className="eyebrow" style={{ marginTop: 14 }}>
            Transit delay
          </div>
          <Banner
            tone={lateDays ? 'flag' : 'mint'}
            title={
              transitDays == null
                ? 'Transit days not recorded for this trip'
                : lateDays
                  ? `${lateDays} day${lateDays === 1 ? '' : 's'} late — ${transitDays} days against ${transitDaysRequired}`
                  : `On time — ${transitDays} day${transitDays === 1 ? '' : 's'}${transitDaysRequired != null ? ` against ${transitDaysRequired}` : ''}`
            }
          >
            {dateChanged
              ? 'The delivery date is being corrected, so the transit days and the late-delivery penalty are worked out again when you verify.'
              : (transitPenaltyPaise ?? 0) > 0
                ? `Late-delivery penalty ${inr(transitPenaltyPaise ?? 0)} — it comes off the final payment. Change the delivery date above if the proof shows a different one.`
                : 'Change the delivery date above if the proof shows a different one.'}
          </Banner>

          <div className="eyebrow" style={{ marginTop: 14 }}>
            Shortages and damages
          </div>
          {findingBlock('shortage', 'Shortage', 'Fewer goods arrived than were sent')}
          {findingBlock('damage', 'Damage', 'Goods arrived damaged')}
          {(form.shortage.on || form.damage.on) && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Each one is recorded as a shortage / damage record (SDR). The transporter’s balance is held until it is
              resolved.
            </p>
          )}

          <div className="eyebrow" style={{ marginTop: 14 }}>
            Charges written on the proof
          </div>
          <div className="pod-check-charges">
            <span />
            <span className="muted">Cost to us (₹)</span>
            <span className="muted">Billed to client (₹)</span>
            {CHARGE_ROWS.map((c) => (
              <div key={c.type} style={{ display: 'contents' }}>
                <span>{c.label}</span>
                <input
                  type="number"
                  min={0}
                  aria-label={`${c.label} — cost to us`}
                  value={form.charges[c.type].cost}
                  onChange={(e) => set({ charges: { ...form.charges, [c.type]: { ...form.charges[c.type], cost: e.target.value } } })}
                />
                <input
                  type="number"
                  min={0}
                  aria-label={`${c.label} — billed to client`}
                  value={form.charges[c.type].billed}
                  onChange={(e) => set({ charges: { ...form.charges, [c.type]: { ...form.charges[c.type], billed: e.target.value } } })}
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <Field label="Anything else on the proof" hint="Optional remarks — kept with the verification.">
              <textarea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
            </Field>
          </div>
        </div>
      </div>
      {problem && (
        <div className="hint" role="status">
          {problem}
        </div>
      )}
    </Dialog>
  );
}

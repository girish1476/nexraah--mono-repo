'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { correctIndentDetails, correctQuote, getIndent, removeQuote, type LoadCorrection } from '@/app/indents/apis';
import type { Quote } from '@/app/indents/types';
import { inr } from '@/lib/format';
import { TRUCK_TYPES } from '@/lib/vehicles';
import { Dialog, Field, FormGrid, useToast } from '@/lib/ui';

/**
 * Putting a mistake right, anywhere in the flow.
 *
 * Something typed wrongly — a weight, a freight, a quote — used to be
 * permanent: the only way out was to cancel the load and raise it again. These
 * are the edits. Each takes effect at once and asks why, and the reason is
 * written to the order's comments, so the record shows what it used to say.
 */

const MIN_REASON = 5;

/** What the load request says now — the fields that can be corrected. */
export interface LoadFacts {
  material: string;
  weightTn: number;
  truckType: string;
  pickupDate: string;
  sellRatePaise: number;
  pickupAddress?: string | null;
  dropAddress?: string | null;
}

/** "✏️ Edit" on a load request: material, weight, truck type, pickup date, freight and the two addresses. */
export function EditLoadButton({
  indentId,
  load,
  onCorrected,
  label = '✏️ Edit',
}: {
  indentId: string;
  load: LoadFacts;
  onCorrected: () => void;
  label?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ material: '', weightTn: '', truckType: '', pickupDate: '', freight: '', pickupAddress: '', dropAddress: '', reason: '' });

  const start = () => {
    setF({
      material: load.material ?? '',
      weightTn: String(load.weightTn ?? ''),
      truckType: load.truckType ?? '',
      pickupDate: String(load.pickupDate ?? '').slice(0, 10),
      freight: String((load.sellRatePaise ?? 0) / 100),
      pickupAddress: load.pickupAddress ?? '',
      dropAddress: load.dropAddress ?? '',
      reason: '',
    });
    setOpen(true);
  };

  // Only what actually changed is sent, so the note on the order lists exactly that.
  const changes = (): Omit<LoadCorrection, 'reason'> => {
    const c: Omit<LoadCorrection, 'reason'> = {};
    if (f.material.trim() !== (load.material ?? '')) c.material = f.material.trim();
    if (Number(f.weightTn) !== Number(load.weightTn)) c.weightTn = Number(f.weightTn);
    if (f.truckType.trim() !== (load.truckType ?? '')) c.truckType = f.truckType.trim();
    if (f.pickupDate !== String(load.pickupDate ?? '').slice(0, 10)) c.pickupDate = f.pickupDate;
    if (Math.round(Number(f.freight) * 100) !== load.sellRatePaise) c.sellRatePaise = Math.round(Number(f.freight) * 100);
    if (f.pickupAddress.trim() !== (load.pickupAddress ?? '')) c.pickupAddress = f.pickupAddress.trim();
    if (f.dropAddress.trim() !== (load.dropAddress ?? '')) c.dropAddress = f.dropAddress.trim();
    return c;
  };
  const changed = Object.keys(changes()).length;
  const problem =
    f.material.trim().length < 2
      ? 'Enter the material.'
      : !(Number(f.weightTn) > 0)
        ? 'Enter the weight in tonnes.'
        : f.truckType.trim().length < 2
          ? 'Choose the truck type.'
          : !f.pickupDate
            ? 'Enter the pickup date.'
            : !(Number(f.freight) > 0)
              ? 'Enter the freight.'
              : changed === 0
                ? 'Nothing has been changed yet.'
                : f.reason.trim().length < MIN_REASON
                  ? 'Say why it is being corrected.'
                  : null;

  const submit = async () => {
    setBusy(true);
    try {
      await correctIndentDetails(indentId, { ...changes(), reason: f.reason.trim() });
      toast('Load request corrected');
      setOpen(false);
      onCorrected();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const types = TRUCK_TYPES.includes(f.truckType as never) || !f.truckType ? TRUCK_TYPES : [f.truckType, ...TRUCK_TYPES];

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={start}>
        {label}
      </button>
      <Dialog
        open={open}
        title="Edit the load request"
        body="Correct anything that was typed wrongly. The change takes effect at once on the order and its trip, and is noted in the order’s comments with your reason."
        confirmLabel="Save changes"
        confirmDisabled={!!problem}
        busy={busy}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      >
        <FormGrid>
          <Field label="Material" required>
            <input value={f.material} onChange={(e) => setF((p) => ({ ...p, material: e.target.value }))} />
          </Field>
          <Field label="Weight (MT)" required>
            <input type="number" min="0" step="0.01" value={f.weightTn} onChange={(e) => setF((p) => ({ ...p, weightTn: e.target.value }))} />
          </Field>
          <Field label="Truck type" required>
            <select value={f.truckType} onChange={(e) => setF((p) => ({ ...p, truckType: e.target.value }))}>
              <option value="">Select</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pickup date" required>
            <input type="date" value={f.pickupDate} onChange={(e) => setF((p) => ({ ...p, pickupDate: e.target.value }))} />
          </Field>
          <Field label="Freight to the client (₹)" required hint="What the client is billed for this load.">
            <input type="number" min="0" value={f.freight} onChange={(e) => setF((p) => ({ ...p, freight: e.target.value }))} />
          </Field>
        </FormGrid>
        <FormGrid cols={1}>
          <Field label="Loading address">
            <textarea rows={2} value={f.pickupAddress} onChange={(e) => setF((p) => ({ ...p, pickupAddress: e.target.value }))} />
          </Field>
          <Field label="Unloading address">
            <textarea rows={2} value={f.dropAddress} onChange={(e) => setF((p) => ({ ...p, dropAddress: e.target.value }))} />
          </Field>
          <Field label="Why it is being corrected" required hint="Kept on the order’s comments.">
            <input value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} placeholder="e.g. Weight was typed from the wrong mail" />
          </Field>
        </FormGrid>
        {problem && (
          <div className="hint" role="status">
            {problem}
          </div>
        )}
      </Dialog>
    </>
  );
}

/** "✏️ Edit" on a quote — its amount, before or after the award. */
export function EditQuoteButton({
  indentId,
  quote,
  awarded = false,
  onCorrected,
  label = '✏️ Edit',
}: {
  indentId: string;
  quote: Pick<Quote, 'id' | 'vendorName' | 'amountPaise'>;
  awarded?: boolean;
  onCorrected: () => void;
  label?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const paise = Math.round(Number(amount) * 100);

  const submit = async () => {
    setBusy(true);
    try {
      await correctQuote(indentId, quote.id, { amountPaise: paise, reason: reason.trim() });
      toast(`Quote corrected to ${inr(paise)}`);
      setOpen(false);
      onCorrected();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setAmount(String(quote.amountPaise / 100));
          setReason('');
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Dialog
        open={open}
        title={awarded ? 'Correct the awarded rate' : 'Edit the quote'}
        body={
          awarded
            ? 'For a rate that was typed wrongly. The transporter’s rate on the order and the trip changes at once; an advance already paid stays as paid, and the balance follows the corrected rate.'
            : 'For an amount that was typed wrongly. The quote changes at once.'
        }
        facts={[
          ['Transporter', quote.vendorName],
          ['Amount on record', inr(quote.amountPaise)],
        ]}
        confirmLabel="Save the amount"
        confirmDisabled={!(paise > 0) || paise === quote.amountPaise || reason.trim().length < MIN_REASON}
        busy={busy}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      >
        <FormGrid cols={1}>
          <Field label="Correct amount (₹)" required>
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Why it is being corrected" required hint="Kept on the order’s comments.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. One zero too many" />
          </Field>
        </FormGrid>
      </Dialog>
    </>
  );
}

/** "🗑 Remove" on a quote entered by mistake, before it is awarded. */
export function RemoveQuoteButton({
  indentId,
  quote,
  onRemoved,
}: {
  indentId: string;
  quote: Pick<Quote, 'id' | 'vendorName' | 'amountPaise'>;
  onRemoved: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const submit = async () => {
    setBusy(true);
    try {
      await removeQuote(indentId, quote.id, reason.trim());
      toast(`Quote from ${quote.vendorName} removed`);
      setOpen(false);
      onRemoved();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setReason('');
          setOpen(true);
        }}
      >
        🗑 Remove
      </button>
      <Dialog
        open={open}
        title="Remove this quote"
        body="For a quote entered by mistake — on the wrong load, or for the wrong transporter. The transporter can be quoted for again afterwards."
        facts={[
          ['Transporter', quote.vendorName],
          ['Quote', inr(quote.amountPaise)],
        ]}
        confirmLabel="Remove the quote"
        confirmDisabled={reason.trim().length < MIN_REASON}
        busy={busy}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      >
        <FormGrid cols={1}>
          <Field label="Why it is being removed" required hint="Kept on the order’s comments.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered on the wrong load" autoFocus />
          </Field>
        </FormGrid>
      </Dialog>
    </>
  );
}

/**
 * "✏️ Correct" beside the transporter's rate on an order — finds the awarded
 * quote itself, so the order page does not have to carry it.
 */
export function CorrectAwardedRateButton({ indentId, onCorrected }: { indentId: string; onCorrected: () => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getIndent(indentId)
      .then((i) => alive && setQuote(i.quotes.find((q) => q.id === i.awardedQuoteId) ?? null))
      .catch(() => alive && setQuote(null));
    return () => {
      alive = false;
    };
  }, [indentId, tick]);
  if (!quote) return null;
  return (
    <EditQuoteButton
      indentId={indentId}
      quote={quote}
      awarded
      label="✏️ Correct"
      onCorrected={() => {
        setTick((t) => t + 1);
        onCorrected();
      }}
    />
  );
}

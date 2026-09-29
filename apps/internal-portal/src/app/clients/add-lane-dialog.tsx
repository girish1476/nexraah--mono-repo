'use client';

import { useState } from 'react';
import { ApprovalRequiredError, errorMessage, request } from '@/apis';
import { TRUCK_TYPES } from '@/lib/vehicles';
import { CityField, Dialog, Field, FormGrid, useToast } from '@/lib/ui';
import { proposeRateLane } from './rate-changes/apis';

/** The floor the server enforces, repeated here so the form says so before you submit. */
const MIN_REASON = 20;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Add a lane to a client's rate card — the five things a lane is: truck type,
 * from, to, transit days and the lane rate.
 *
 * The rate card used to be written only by winning a rate request (RFQ), so a
 * client who had agreed prices on paper had an empty card until a whole
 * quotation cycle had been run. This is the other way in. It does not write the
 * lane: like a rate change it is sent for sign-off, and the lane appears when
 * somebody who can approve a contract agrees.
 */
export function AddLaneDialog({
  clientId,
  clientName,
  open,
  onClose,
  onSent,
}: {
  clientId: string;
  clientName: string;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [truckType, setTruckType] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [transitDays, setTransitDays] = useState('');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState(today());
  const [validTo, setValidTo] = useState('');
  const [reason, setReason] = useState('');
  const [penaltyApplies, setPenaltyApplies] = useState(false);
  const [penaltyPerDay, setPenaltyPerDay] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [mailFile, setMailFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPenaltyApplies(false);
    setPenaltyPerDay('');
    setMailSubject('');
    setMailFile(null);
    setTruckType('');
    setOrigin('');
    setDestination('');
    setTransitDays('');
    setRate('');
    setValidFrom(today());
    setValidTo('');
    setReason('');
  };

  const rupees = Number(rate);
  const days = Number(transitDays);
  const problem = (() => {
    if (!truckType.trim()) return 'Say which truck type this rate is for.';
    if (origin.trim().length < 2 || destination.trim().length < 2) return 'Put in both the from and to city.';
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) return 'The from and to city are the same.';
    if (transitDays.trim() === '' || !Number.isInteger(days) || days < 0 || days > 60) {
      return 'Transit days should be a whole number of days.';
    }
    if (!Number.isFinite(rupees) || rupees <= 0) return 'Put in the lane rate.';
    if (!validFrom) return 'Say when the rate starts.';
    if (validTo && validTo < validFrom) return 'The rate cannot end before it starts.';
    if (penaltyApplies && !(Number(penaltyPerDay) > 0)) return 'Put in what a late day costs, or switch the late-delivery penalty off.';
    if (mailSubject.trim().length < 5) return 'Put in the subject of the BD and Leadership approval mail.';
    if (reason.trim().length < MIN_REASON) {
      return `Say where this rate was agreed (at least ${MIN_REASON} characters).`;
    }
    return null;
  })();

  const submit = async () => {
    setBusy(true);
    try {
      // Never resolves on success: it answers `202 approvalRequired`, which
      // `request()` throws as `ApprovalRequiredError`. That error IS the
      // "sent for sign-off" outcome.
      // The screenshot of the approval mail, when there is one, goes up first.
      let approvalMailAttachmentId: string | undefined;
      if (mailFile) {
        const form = new FormData();
        form.append('file', mailFile);
        form.append('kind', 'RATE_APPROVAL_MAIL');
        form.append('entityType', 'clients');
        form.append('entityId', clientId);
        const uploaded = await request<{ id: string }>({ url: '/attachments', method: 'POST', data: form });
        approvalMailAttachmentId = uploaded.id;
      }
      await proposeRateLane(clientId, {
        origin: origin.trim(),
        destination: destination.trim(),
        truckType: truckType.trim(),
        ratePaise: Math.round(rupees * 100),
        transitDays: days,
        validFrom,
        ...(validTo ? { validTo } : {}),
        reason: reason.trim(),
        transitPenaltyApplies: penaltyApplies,
        ...(penaltyApplies ? { transitPenaltyPerDayPaise: Math.round(Number(penaltyPerDay) * 100) } : {}),
        approvalMailSubject: mailSubject.trim(),
        ...(approvalMailAttachmentId ? { approvalMailAttachmentId } : {}),
      });
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        toast('Sent for sign-off. The lane is added to the rate card once it is approved.');
        reset();
        onClose();
        onSent();
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={`Add a lane · ${clientName}`}
      body="One route at one truck type, with the rate agreed for it. It is sent for sign-off and joins the rate card once approved."
      confirmLabel="Send for sign-off"
      confirmDisabled={Boolean(problem)}
      busy={busy}
      onConfirm={submit}
      onClose={onClose}
    >
      <FormGrid>
        <Field label="Truck type" required>
          <input
            list="add-lane-truck-types"
            value={truckType}
            onChange={(e) => setTruckType(e.target.value)}
            placeholder="e.g. 32 ft MXL"
            autoFocus
          />
          <datalist id="add-lane-truck-types">
            {TRUCK_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Transit days" required hint="How many days the client expects the load to take.">
          <input type="number" min={0} max={60} value={transitDays} onChange={(e) => setTransitDays(e.target.value)} />
        </Field>
        <Field label="From location" required>
          <CityField listId="add-lane-from" value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </Field>
        <Field label="To location" required>
          <CityField listId="add-lane-to" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </Field>
        <Field label="Lane rate (₹)" required hint="What we charge this client for one load on this route.">
          <input type="number" min={1} value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field
          label="Late-delivery penalty"
          required
          hint="It varies with the client, route and truck type. Switch it on only where this rate carries one."
        >
          <select value={penaltyApplies ? 'YES' : 'NO'} onChange={(e) => setPenaltyApplies(e.target.value === 'YES')}>
            <option value="NO">Not applied on this lane</option>
            <option value="YES">Applied on this lane</option>
          </select>
        </Field>
        {penaltyApplies && (
          <Field label="Penalty per late day (₹)" required hint="Counted from the day loading is done, past the transit days above.">
            <input type="number" min={1} value={penaltyPerDay} onChange={(e) => setPenaltyPerDay(e.target.value)} />
          </Field>
        )}
        <Field label="Starts from" required>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label="Runs until" hint="Leave empty if it has no end date.">
          <input type="date" min={validFrom} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </FormGrid>
      <Field
        label="Approval mail subject"
        required
        hint="BD and Leadership approve a rate by mail. Compliance signs it off against that mail, so its subject line goes on record."
      >
        <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} placeholder="e.g. RE: Berger Paints Kolkata–Guwahati rate approval" />
      </Field>
      <Field label="Screenshot of the mail" hint="Optional — attach it so the sign-off can be checked later.">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setMailFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field
        label="Where this rate was agreed"
        required
        hint="The contract clause, email or call. Whoever signs it off decides from this."
      >
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Annexure 2 of the signed agreement dated 1 September"
        />
      </Field>
      {problem && (truckType || origin || destination || rate || reason || mailSubject) && (
        <div className="hint" role="status">
          {problem}
        </div>
      )}
    </Dialog>
  );
}

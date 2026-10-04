'use client';

import { useState } from 'react';
import { errorMessage } from '@/apis';
import { correctVehicle } from '@/app/indents/apis';
import { Dialog, Field, FormGrid, useToast } from '@/lib/ui';

/**
 * "Correct" beside an order's truck number — for a number that was typed
 * wrongly, not for putting a different truck on the load.
 *
 * The corrected number is written to the load, the trip and the lorry receipt
 * together, and the reason goes to the activity log. It is offered until the
 * truck is unloaded; the server refuses after that, when the number is already
 * on the delivery papers.
 */
export function CorrectVehicleButton({
  indentId,
  vehicleNo,
  onCorrected,
}: {
  indentId: string;
  vehicleNo: string;
  onCorrected: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState('');
  const [reason, setReason] = useState('');

  const typed = next.trim().toUpperCase();

  const submit = async () => {
    setBusy(true);
    try {
      await correctVehicle(indentId, { vehicleNo: typed, reason: reason.trim() });
      toast(`Truck number corrected to ${typed}`);
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
        style={{ marginLeft: 6 }}
        onClick={() => {
          setNext('');
          setReason('');
          setOpen(true);
        }}
      >
        ✏️ Correct
      </button>

      <Dialog
        open={open}
        title="Correct the truck number"
        body="For a number that was typed wrongly. It is put right on the load, the trip and the lorry receipt. Documents already uploaded are not changed — if one shows the wrong number, replace it on the Documents tab."
        facts={[['Number on record', vehicleNo]]}
        confirmLabel="Correct the number"
        confirmDisabled={typed.length < 4 || typed === vehicleNo || reason.trim().length < 5}
        busy={busy}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      >
        <FormGrid cols={1}>
          <Field label="Correct truck number" required>
            <input value={next} onChange={(e) => setNext(e.target.value.toUpperCase())} placeholder="e.g. AP39EW3669" autoFocus />
          </Field>
          <Field label="Why it is being corrected" required hint="Kept in the activity log.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two digits swapped when it was typed in" />
          </Field>
        </FormGrid>
      </Dialog>
    </>
  );
}

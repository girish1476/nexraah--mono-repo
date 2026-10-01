'use client';

import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { Dialog, Field, useToast } from '@/lib/ui';
import { sessionAtom } from '@/store/atoms';
import { RATE_DELETE_ROLES } from './types';

const MIN_REASON = 10;

/** Only Leadership or an administrator delete a duplicate rate — the server checks the same. */
export function useCanDeleteRates(): boolean {
  const session = useAtomValue(sessionAtom);
  return !!session && (RATE_DELETE_ROLES as readonly string[]).includes(session.role);
}

/**
 * Asks why before deleting a rate — a lane on the rate card, a lane waiting
 * for sign-off, or a rate change waiting for sign-off. Duplicates get entered;
 * this is how they come off, with the reason kept on record.
 */
export function DeleteRateDialog({
  target,
  onClose,
  onDeleted,
}: {
  /** What is being deleted, in words ("Nashik → Kolkata · 32 ft MXL at ₹64,200 / truck"), and the call that deletes it. */
  target: { label: string; run: (reason: string) => Promise<unknown> } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) setReason('');
  }, [target]);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await target.run(reason.trim());
      toast(`Deleted · ${target.label}`);
      onClose();
      onDeleted();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!target}
      title="Delete this rate?"
      body={`${target?.label ?? ''}. Use this for a duplicate entered by mistake. Loads already raised keep the price they were raised at, and the deletion is kept on record with your reason.`}
      confirmLabel="Delete rate"
      confirmDisabled={reason.trim().length < MIN_REASON}
      busy={busy}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field label="Why is it being deleted?" required hint={`At least ${MIN_REASON} characters, e.g. “Duplicate of the lane added on 30 Sep”.`}>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}

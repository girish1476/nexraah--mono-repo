'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { getLoadingSupervisorOptions, type LoadingSupervisorOption } from '@/app/trips/apis';
import { Banner, Dialog, Field, useCan } from '@/lib/ui';

/**
 * "Assign loading supervisor" — the one dialog the trip page and the order's
 * next step both open.
 *
 * Only people with the Loading supervisor role, for this trip's branch or the
 * whole company, can be chosen. On a fresh database nobody has that role yet,
 * and the list used to open with nothing but "Choose a person…" — no names, no
 * reason (preprod, 10 Nov 2026), while the demo showed its sample supervisor.
 * Now the dialog says why the list is empty and where to add someone, and a
 * failed lookup shows its own message instead of an empty list.
 */
export function LoadingSupervisorDialog({
  open,
  tripId,
  currentId,
  body,
  busy,
  onAssign,
  onClose,
}: {
  open: boolean;
  tripId: string;
  currentId: string | null;
  body: string;
  busy?: boolean;
  onAssign: (userId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const can = useCan();
  const [options, setOptions] = useState<LoadingSupervisorOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setOptions(null);
    setError(null);
    setChosen(currentId ?? '');
    getLoadingSupervisorOptions(tripId)
      .then((rows) => live && setOptions(rows))
      .catch((e) => {
        if (!live) return;
        setOptions([]);
        setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [open, tripId, currentId]);

  const nobody = options !== null && options.length === 0 && !error;

  return (
    <Dialog
      open={open}
      title="Assign loading supervisor"
      body={body}
      confirmLabel="Assign"
      confirmDisabled={!chosen || !options?.length}
      busy={busy}
      onConfirm={() => void onAssign(chosen)}
      onClose={onClose}
    >
      {error ? (
        <Banner tone="red" title="Could not load the loading supervisors">
          {error}
        </Banner>
      ) : nobody ? (
        <Banner tone="flag" title="No loading supervisor set up yet">
          Nobody has the <b>Loading supervisor</b> role for this trip&apos;s branch.{' '}
          {can('config.manage') ? (
            <>
              Add the person under <Link href="/admin/users">People and access</Link> with the role Loading
              supervisor (branch: this trip&apos;s branch, or the whole company), then open this again.
            </>
          ) : (
            <>Ask an administrator to add them under People and access with the role Loading supervisor.</>
          )}
        </Banner>
      ) : (
        <Field label="Supervisor" required>
          <select value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={options === null}>
            <option value="">{options === null ? 'Loading the list…' : 'Choose a person…'}</option>
            {(options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Dialog>
  );
}

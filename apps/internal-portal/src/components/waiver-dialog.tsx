'use client';

import { ReactNode, useState } from 'react';
import { Dialog, Field } from '@/lib/ui';

export interface WaiverEvidence {
  mailSubject: string;
  file: File | null;
}

/**
 * Waiving a penalty. Leadership agrees a waiver by mail and Compliance records
 * it, so the mail's subject is what this asks for — and it is required, because
 * a waiver with no evidence behind it cannot be defended later. The mail's
 * screenshot is optional.
 */
export function WaiverDialog({
  open,
  title,
  body,
  facts,
  confirmLabel = 'Record waiver',
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  facts?: [string, ReactNode][];
  confirmLabel?: string;
  busy: boolean;
  onConfirm: (evidence: WaiverEvidence) => void;
  onClose: () => void;
}) {
  const [mailSubject, setMailSubject] = useState('');
  const [file, setFile] = useState<File | null>(null);

  return (
    <Dialog
      open={open}
      title={title}
      body={body}
      facts={facts}
      confirmLabel={confirmLabel}
      confirmDisabled={mailSubject.trim().length < 5}
      busy={busy}
      onConfirm={() => onConfirm({ mailSubject: mailSubject.trim(), file })}
      onClose={() => {
        setMailSubject('');
        setFile(null);
        onClose();
      }}
    >
      <Field
        label="Leadership approval mail — subject"
        required
        hint="Leadership approves a waiver by mail. The subject goes on record as the evidence."
      >
        <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} placeholder="e.g. RE: Waiver approval for trip 120874" />
      </Field>
      <Field label="Screenshot of the mail" hint="Optional.">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </Dialog>
  );
}

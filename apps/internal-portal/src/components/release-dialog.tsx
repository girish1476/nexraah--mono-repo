'use client';

import { ReactNode, useState } from 'react';
import { Dialog, Field, FormGrid } from '@/lib/ui';
import { PAYMENT_MODES, TRANSFER_TYPES } from '@/lib/documents';
import { PaymentCapture } from '@/app/payments/types';

/**
 * The release dialog — used by the advance panel, the balance panel and the
 * bill queue. BR-09 makes all five fields mandatory on the payment row, so
 * the button stays disabled until all five are present.
 */
export function ReleaseDialog({
  open,
  title,
  body,
  facts,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  facts: [string, ReactNode][];
  confirmLabel: string;
  busy: boolean;
  onConfirm: (capture: PaymentCapture) => void;
  onClose: () => void;
}) {
  const [capture, setCapture] = useState<PaymentCapture>({
    mode: 'NEFT',
    transferType: 'VENDOR_ACCOUNT',
    remittingAccount: 'HDFC ••4471',
    utr: '',
    valueDate: new Date().toISOString().slice(0, 10),
  });

  const complete = Object.values(capture).every((v) => String(v).trim().length > 0);
  const set = (patch: Partial<PaymentCapture>) => setCapture((c) => ({ ...c, ...patch }));

  return (
    <Dialog
      open={open}
      title={title}
      body={body}
      facts={facts}
      confirmLabel={confirmLabel}
      confirmDisabled={!complete}
      busy={busy}
      onConfirm={() => onConfirm(capture)}
      onClose={onClose}
    >
      <FormGrid>
        <Field label="Mode" required>
          <select value={capture.mode} onChange={(e) => set({ mode: e.target.value })}>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Transfer type" required>
          <select value={capture.transferType} onChange={(e) => set({ transferType: e.target.value })}>
            {TRANSFER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Remitting account" required>
          <input value={capture.remittingAccount} onChange={(e) => set({ remittingAccount: e.target.value })} />
        </Field>
        <Field label="UTR" required hint="Keyed from the bank. Reconciled against the statement feed.">
          <input value={capture.utr} onChange={(e) => set({ utr: e.target.value })} />
        </Field>
        <Field label="Value date" required>
          <input type="date" value={capture.valueDate} onChange={(e) => set({ valueDate: e.target.value })} />
        </Field>
      </FormGrid>
    </Dialog>
  );
}

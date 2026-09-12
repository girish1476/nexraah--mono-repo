'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { Column, DataTable, ErrorState, Loading, ModuleGuard, PageHeader, Panel, Tag, useCan, useToast } from '@/lib/ui';
import { backfillKycValue, getAttachmentUrl, getKycBackfillQueue, KycBackfillRow } from '../apis';

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const AADHAAR_LAST4_RE = /^\d{4}$/;

const KYC_NORMALIZE: Record<string, (value: string) => string> = {
  PAN: (v) => v.toUpperCase().slice(0, 10),
  AADHAAR: (v) => v.replace(/\D/g, '').slice(0, 4),
};
const KYC_VALIDATE: Record<string, (value: string) => string | undefined> = {
  PAN: (v) => (PAN_RE.test(v) ? undefined : 'PAN looks wrong, e.g. AAKCR2148L'),
  AADHAAR: (v) => (AADHAAR_LAST4_RE.test(v) ? undefined : 'Enter the last four digits only'),
};
const KYC_PLACEHOLDER: Record<string, string> = { PAN: 'PAN number', AADHAAR: 'Last four digits' };
const KYC_LABEL: Record<string, string> = { PAN: 'PAN card', AADHAAR: 'Aadhaar card' };

/**
 * `/vendors/kyc-backfill` · `vendor.verify` (Compliance).
 *
 * Every vendor whose PAN or Aadhaar card was photographed correctly during
 * onboarding but never had its number typed in — the wizard's identity
 * fields were suppressed for both kinds until 2026-08-26 (see
 * `lib/documents.ts`). The photo is the source of truth; this screen exists
 * so Compliance can open it and key in what it already says, without
 * disturbing whatever verification already happened.
 */
export default function KycBackfillPage() {
  const can = useCan();
  const toast = useToast();

  const [rows, setRows] = useState<KycBackfillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const rowKey = (r: KycBackfillRow) => `${r.vendorId}:${r.kind}`;

  const load = () => {
    setError(null);
    getKycBackfillQueue()
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const onOpenPhoto = async (attachmentId: string) => {
    try {
      const { url } = await getAttachmentUrl(attachmentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onValueChange = (key: string, kind: string, raw: string) => {
    const next = KYC_NORMALIZE[kind] ? KYC_NORMALIZE[kind](raw) : raw;
    setValues((v) => ({ ...v, [key]: next }));
    setErrors((e) => ({ ...e, [key]: KYC_VALIDATE[kind]?.(next) }));
  };

  const onSubmit = async (r: KycBackfillRow) => {
    const key = rowKey(r);
    const value = (values[key] ?? '').trim();
    if (!value || errors[key]) return;
    setBusyKey(key);
    try {
      await backfillKycValue(r.vendorId, r.kind, value);
      toast(`${KYC_LABEL[r.kind]} recorded · ${r.vendorName}`);
      setRows((prev) => (prev ? prev.filter((row) => rowKey(row) !== key) : prev));
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  if (!can('vendor.verify')) {
    return (
      <ModuleGuard module="vendors">
        <PageHeader path="/vendors/kyc-backfill" title="Missing PAN and Aadhaar values" module="vendors" />
        <Panel>Only Compliance can open identity photos and record these values.</Panel>
      </ModuleGuard>
    );
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading the backfill queue" />;

  const columns: Column<KycBackfillRow>[] = [
    { key: 'vendor', label: 'Transporter', render: (r) => `${r.vendorName} · ${r.vendorCode}` },
    { key: 'kind', label: 'Check', render: (r) => <Tag tone="flag">{KYC_LABEL[r.kind]}</Tag> },
    { key: 'status', label: 'State', render: (r) => r.status },
    {
      key: 'photo',
      label: '',
      render: (r) => (
        <button className="btn btn-secondary btn-sm" onClick={() => onOpenPhoto(r.attachmentId)}>
          View photo
        </button>
      ),
    },
    {
      key: 'value',
      label: 'Value on the photo',
      align: 'right',
      render: (r) => {
        const key = rowKey(r);
        const value = values[key] ?? '';
        const fieldError = errors[key];
        return (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <input
              style={{
                width: 130,
                padding: '5px 7px',
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'inherit',
                fontSize: 12,
              }}
              placeholder={KYC_PLACEHOLDER[r.kind]}
              value={value}
              onChange={(e) => onValueChange(key, r.kind, e.target.value)}
              disabled={busyKey === key}
            />
            {fieldError && <span style={{ fontSize: 11, color: 'var(--red)' }}>{fieldError}</span>}
            <button
              className="btn btn-secondary btn-sm"
              disabled={!value.trim() || !!fieldError || busyKey === key}
              onClick={() => onSubmit(r)}
            >
              {busyKey === key ? 'Saving…' : 'Save'}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/kyc-backfill"
        title="Missing PAN and Aadhaar values"
        sub={`${rows.length} to re-key from the photo already on file`}
        module="vendors"
      />
      <Panel title="Backfill queue" pad={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          empty="Nothing left to backfill — every PAN and Aadhaar card has a recorded value."
        />
      </Panel>
    </ModuleGuard>
  );
}

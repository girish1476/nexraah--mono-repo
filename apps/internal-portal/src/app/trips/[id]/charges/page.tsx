'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { CHARGE_TYPES } from '@/lib/documents';
import { fmtDateTime, inr, pct } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  useCan,
  useToast,
} from '@/lib/ui';
import { addCharge, getCharges } from '../../apis';
import { TripCharge } from '../../types';
import { TripTabs } from '../tabs';

/**
 * Charges — `/trips/[id]/charges` (part 05 §4).
 *
 * Cost to us and value billed to the client are separate columns, so the
 * mark-up is visible in the margin (BR-45). This is what makes the P&L true:
 * a trip closed with no charges overstates margin and nothing else will tell
 * you (R-01).
 *
 * The same form opens inside POD verification, which is where charges are
 * normally captured — someone is actually reading the document at that
 * moment (BR-56).
 */
export default function TripChargesPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();

  const [rows, setRows] = useState<TripCharge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ chargeType: 'LOADING', costRupees: 0, billedRupees: 0 });
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    getCharges(id).then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const submit = async () => {
    setBusy(true);
    try {
      await addCharge(id, {
        chargeType: form.chargeType,
        costAmountPaise: Math.round(form.costRupees * 100),
        billedAmountPaise: Math.round(form.billedRupees * 100),
      });
      toast(`${form.chargeType.toLowerCase()} captured`);
      setForm({ chargeType: 'LOADING', costRupees: 0, billedRupees: 0 });
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading charges" />;

  const cost = rows.reduce((a, r) => a + r.costAmountPaise, 0);
  const billed = rows.reduce((a, r) => a + r.billedAmountPaise, 0);
  const markupBelowCost = form.billedRupees > 0 && form.billedRupees < form.costRupees;

  const columns: Column<TripCharge>[] = [
    { key: 'type', label: 'Charge', render: (r) => r.chargeType.replace(/_/g, ' ').toLowerCase() },
    { key: 'cost', label: 'Cost to us', align: 'right', render: (r) => inr(r.costAmountPaise) },
    { key: 'billed', label: 'Billed to client', align: 'right', render: (r) => inr(r.billedAmountPaise) },
    {
      key: 'markup',
      label: 'Mark-up',
      align: 'right',
      render: (r) => {
        const m = r.billedAmountPaise - r.costAmountPaise;
        return (
          <span style={{ color: m >= 0 ? 'var(--mint)' : 'var(--red)' }}>
            {inr(m)} · {pct(r.costAmountPaise ? (m / r.costAmountPaise) * 100 : 0, 0)}
          </span>
        );
      },
    },
    { key: 'by', label: 'Captured by', render: (r) => `${r.capturedBy} · ${fmtDateTime(r.capturedAt)}` },
  ];

  return (
    <ModuleGuard module="trips">
      <PageHeader
        path={`/trips/${id}/charges`}
        title="Charges"
        sub="Cost and billed value are held separately — the difference between them is the margin on this trip."
        module="trips"
      />
      <PageIntro
        what="Record what this trip cost against what's billed to the client — the gap between them is the margin on this trip."
        who="Captured by operations or compliance, usually during POD verification."
      />
      <TripTabs tripId={id} />

      <Stack>
        {rows.length === 0 && (
          <Banner tone="flag" title="No charges captured on this trip">
            A trip closed with no charges appears in the P&L exception panel and in the weekly
            charge-capture-exception job. The margin on it is overstated until someone enters what was actually
            paid.
          </Banner>
        )}

        <Panel pad={false}>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="Nothing captured yet." />
          {rows.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 14px',
                borderTop: '1px solid var(--color-divider)',
                fontWeight: 600,
              }}
            >
              <span>Total</span>
              <span className="mono">
                cost {inr(cost)} · billed {inr(billed)} · mark-up {inr(billed - cost)}
              </span>
            </div>
          )}
        </Panel>

        {can('document.verify') || can('pod.verify') || can('indent.manage') ? (
          <Panel title="Capture a charge">
            <FormGrid>
              <Field label="Charge type" required>
                <select value={form.chargeType} onChange={(e) => setForm({ ...form, chargeType: e.target.value })}>
                  {CHARGE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cost to us (₹)" required hint="Payable to the transporter.">
                <input
                  type="number"
                  value={form.costRupees || ''}
                  onChange={(e) => setForm({ ...form, costRupees: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Billed to client (₹)"
                required
                error={markupBelowCost ? 'Below cost — this loses money on the charge' : undefined}
              >
                <input
                  type="number"
                  value={form.billedRupees || ''}
                  onChange={(e) => setForm({ ...form, billedRupees: Number(e.target.value) })}
                />
              </Field>
            </FormGrid>
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={submit} disabled={busy || !form.costRupees}>
                Capture
              </button>
            </div>
          </Panel>
        ) : (
          <Panel>
            <span className="muted">Charges are captured at POD verification by branch or compliance.</span>
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}

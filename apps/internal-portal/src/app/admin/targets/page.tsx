'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { inr } from '@/lib/format';
import {
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  useCan,
  useToast,
} from '@/lib/ui';
import { listTargets, setTargets } from './apis';
import {
  MonthTargets,
  TARGET_DESK,
  TARGET_LABEL,
  TARGET_METRICS,
  TARGET_UNIT,
  TargetMetric,
} from './types';

type Row = MonthTargets['rows'][number];

/** A stored target as the number somebody types: rupees for money, the count itself otherwise. */
const toInput = (metric: TargetMetric, value: number | null) =>
  value === null ? '' : String(TARGET_UNIT[metric] === 'PAISE' ? value / 100 : value);

const show = (metric: TargetMetric, value: number | null) =>
  value === null ? <span className="muted">Not set</span> : TARGET_UNIT[metric] === 'PAISE' ? inr(value) : value;

/**
 * Targets — `/admin/targets` · `config.manage`.
 *
 * One target per branch, per month, per measure. My desk holds each desk's
 * achieved figures against these. The quarter is never entered: it is the sum
 * of its three months.
 */
export default function TargetsPage() {
  const can = useCan();
  const toast = useToast();
  const editable = can('config.manage');

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<MonthTargets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<TargetMetric, string>>({} as Record<TargetMetric, string>);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    listTargets(month).then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [month]);

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm(
      Object.fromEntries(TARGET_METRICS.map((m) => [m, toInput(m, row.targets[m])])) as Record<TargetMetric, string>,
    );
  };

  const invalid = TARGET_METRICS.some((m) => form[m] !== '' && !(Number(form[m]) >= 0));

  const submit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const targets = Object.fromEntries(
        TARGET_METRICS.map((m) => [
          m,
          form[m] === '' ? null : Math.round(Number(form[m]) * (TARGET_UNIT[m] === 'PAISE' ? 100 : 1)),
        ]),
      ) as Record<TargetMetric, number | null>;
      setData(await setTargets({ month, branchId: editing.branchId, targets }));
      toast(`Targets for ${editing.branchName} saved`);
      setEditing(null);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading targets" />;

  const columns: Column<Row>[] = [
    { key: 'branch', label: 'Branch', primary: true, render: (r) => r.branchName },
    ...TARGET_METRICS.map(
      (m): Column<Row> => ({
        key: m,
        label: TARGET_LABEL[m],
        align: 'right',
        render: (r) => show(m, r.targets[m]),
      }),
    ),
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        editable ? (
          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>
            Set targets
          </button>
        ) : null,
    },
  ];

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin/targets"
        title="Targets"
        sub="What each branch is aiming for in a month — shown against what is achieved on My desk"
        module="admin"
        right={
          <Field label="Month">
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
        }
      />
      <PageIntro
        what="A target is set for a branch, for a month, in each measure. Each desk sees its own measure on My desk: Operations sees loads and margin, Business development sees billing, Finance sees collections, Compliance sees delivery proofs, and Leadership sees all of them. Somebody who belongs to a branch sees that branch’s target; everyone else sees all branches added together. The quarter is the three months added together, so it is never entered here."
        who="An administrator sets them."
      />

      <Panel pad={false}>
        <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.branchId} empty="No branches yet." />
      </Panel>

      <Dialog
        open={!!editing}
        title={`Targets · ${editing?.branchName ?? ''} · ${month}`}
        body="Leave a box empty to have no target in that measure."
        confirmLabel="Save targets"
        confirmDisabled={invalid}
        busy={busy}
        onConfirm={submit}
        onClose={() => setEditing(null)}
      >
        <FormGrid>
          {TARGET_METRICS.map((m) => (
            <Field
              key={m}
              label={`${TARGET_LABEL[m]}${TARGET_UNIT[m] === 'PAISE' ? ' (₹)' : ''}`}
              hint={`Shown to ${TARGET_DESK[m]}`}
            >
              <input
                type="number"
                min={0}
                value={form[m] ?? ''}
                onChange={(e) => setForm({ ...form, [m]: e.target.value })}
              />
            </Field>
          ))}
        </FormGrid>
      </Dialog>
    </ModuleGuard>
  );
}

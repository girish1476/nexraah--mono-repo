'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { capitalizeWords, fmtDate, inr } from '@/lib/format';
import {
  CityField,
  Column,
  DataTable,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useCan,
  useLevel,
  useToast,
} from '@/lib/ui';
import { addLane, getRfq, submitRfq } from '../apis';
import { Rfq, RfqLane } from '../types';

/** RFQ lanes — `/rfq/[id]` (part 09 §1). */
export default function RfqDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const level = useLevel('rfq');
  const toast = useToast();

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lane, setLane] = useState({
    origin: '',
    destination: '',
    truckType: '',
    transitDays: 2,
    reportingRule: 'SAME_DAY',
  });

  const load = () => {
    setError(null);
    getRfq(id).then(setRfq).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const add = async () => {
    setBusy(true);
    try {
      await addLane(id, lane);
      toast(`${lane.origin} → ${lane.destination} added`);
      setLane({ origin: '', destination: '', truckType: '', transitDays: 2, reportingRule: 'SAME_DAY' });
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await submitRfq(id);
      toast('Submitted to the client');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rfq) return <Loading what="Loading the RFQ" />;

  const columns: Column<RfqLane>[] = [
    { key: 'lane', label: 'Lane', render: (r) => `${r.origin} → ${r.destination}` },
    { key: 'truck', label: 'Truck type', render: (r) => r.truckType },
    { key: 'transit', label: 'Transit', align: 'right', render: (r) => `${r.transitDays}d` },
    { key: 'report', label: 'Reporting', render: (r) => r.reportingRule.replace(/_/g, ' ').toLowerCase() },
    { key: 'mode', label: 'Sourcing', render: (r) => <Tag tone="grey">{r.sourcingMode.replace('_', '/')}</Tag> },
    { key: 'avg', label: 'Sourcing avg', align: 'right', render: (r) => inr(r.sourcingAvgPaise) },
    { key: 'oh', label: 'Overhead', align: 'right', render: (r) => inr(r.overheadPaise) },
    { key: 'margin', label: 'Margin', align: 'right', render: (r) => inr(r.marginPaise) },
    {
      key: 'quoted',
      label: 'Quoted rate',
      align: 'right',
      render: (r) => <strong className="mono">{inr(r.quotedRatePaise)}</strong>,
    },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (r) =>
        r.outcome ? (
          <Tag tone={r.outcome === 'WON' ? 'mint' : r.outcome === 'LOST' ? 'red' : 'grey'}>{r.outcome}</Tag>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Link href={`/rfq/${id}/lanes/${r.id}/sourcing`} className="btn btn-secondary btn-sm">
            Sourcing
          </Link>
          <Link href={`/rfq/${id}/lanes/${r.id}/quote`} className="btn btn-secondary btn-sm">
            Build-up
          </Link>
        </div>
      ),
    },
  ];

  return (
    <ModuleGuard module="rfq">
      <PageHeader
        path={`/rfq/${rfq.reference}`}
        title={`${rfq.clientName} · ${rfq.reference}`}
        sub={`${rfq.cycleMonths} months · ${fmtDate(rfq.periodFrom)} – ${fmtDate(rfq.periodTo)} · due ${fmtDate(rfq.dueAt)}`}
        module="rfq"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tag tone="blue">{rfq.status}</Tag>
            {rfq.status === 'QUOTED' &&
              (can('rfq.submit') ? (
                <button className="btn" onClick={submit} disabled={busy}>
                  Submit to client
                </button>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  Only LEADERSHIP may submit
                </span>
              ))}
            {['SUBMITTED', 'AWARDED'].includes(rfq.status) && (
              <Link href={`/rfq/${id}/award`} className="btn">
                Record award
              </Link>
            )}
          </div>
        }
      />

      <Stack>
        <Panel pad={false}>
          <DataTable columns={columns} rows={rfq.lanes} rowKey={(r) => r.id} empty="No lanes yet." />
        </Panel>

        {level === 'EDIT' && rfq.status !== 'SUBMITTED' && (
          <Panel title="Add a lane">
            <FormGrid>
              <Field label="Origin" required>
                <CityField
                  listId="cities-lane-origin"
                  value={lane.origin}
                  onChange={(e) => setLane({ ...lane, origin: e.target.value })}
                  onBlur={(e) => setLane((l) => ({ ...l, origin: capitalizeWords(e.target.value) }))}
                />
              </Field>
              <Field label="Destination" required>
                <CityField
                  listId="cities-lane-destination"
                  value={lane.destination}
                  onChange={(e) => setLane({ ...lane, destination: e.target.value })}
                  onBlur={(e) => setLane((l) => ({ ...l, destination: capitalizeWords(e.target.value) }))}
                />
              </Field>
              <Field label="Truck type" required>
                <input value={lane.truckType} onChange={(e) => setLane({ ...lane, truckType: e.target.value })} />
              </Field>
              <Field label="Transit days" required hint="A client requirement that must reach the indent and the LR.">
                <input
                  type="number"
                  value={lane.transitDays}
                  onChange={(e) => setLane({ ...lane, transitDays: Number(e.target.value) })}
                />
              </Field>
              <Field label="Reporting rule" required>
                <select value={lane.reportingRule} onChange={(e) => setLane({ ...lane, reportingRule: e.target.value })}>
                  <option value="SAME_DAY">Same day</option>
                  <option value="NEXT_DAY">Next day</option>
                  <option value="SCHEDULED">Scheduled</option>
                </select>
              </Field>
            </FormGrid>
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={add} disabled={busy || !lane.origin || !lane.destination}>
                Add lane
              </button>
            </div>
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}

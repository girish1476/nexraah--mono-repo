'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { POD_TONE } from '@/lib/documents';
import { fmtDate, inr } from '@/lib/format';
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
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { getReceiving, receivePod } from '../apis';
import { ReceivingResponse, ReceivingRow } from '../types';

/**
 * Receiving register — `/pod/receiving` · `pod.receive` (part 06 §2).
 *
 * The physical copy arriving by courier, days after the photograph. That week
 * is where PODs are lost: a docket raised eight days ago with nothing arrived
 * is visible here, and the branch chases the courier rather than the
 * transporter.
 */
export default function PodReceivingPage() {
  const can = useCan();
  const toast = useToast();
  const [data, setData] = useState<ReceivingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<ReceivingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    courierDocket: '',
    sentOn: '',
    receivedOn: new Date().toISOString().slice(0, 10),
    pages: 2,
    condition: '',
  });

  const load = () => {
    setError(null);
    getReceiving().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const submit = async () => {
    if (!logging) return;
    setBusy(true);
    try {
      const receipt = await receivePod(logging.tripId, form);
      toast(`${receipt.code} logged · the clock has stopped for ${logging.tripCode}`);
      setLogging(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading the receiving register" />;

  const columns: Column<ReceivingRow>[] = [
    { key: 'lr', label: 'LR', mono: true, render: (r) => r.lrCode ?? '—' },
    {
      key: 'trip',
      label: 'Trip',
      render: (r) => (
        <Link href={`/trips/${r.tripId}`} className="mono" style={{ fontSize: 12 }}>
          {r.tripCode}
        </Link>
      ),
    },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
    { key: 'docket', label: 'Courier docket', mono: true, render: (r) => r.courierDocket ?? '—' },
    {
      key: 'day',
      label: 'Day',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.ageDays > 40 ? 'var(--red)' : r.ageDays > 20 ? 'var(--flag)' : undefined }}>
          {r.ageDays}
        </span>
      ),
    },
    { key: 'held', label: 'Balance held', align: 'right', render: (r) => inr(r.balanceHeldPaise) },
    { key: 'state', label: 'Chain', render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{r.podStatus}</Tag> },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => {
        if (['RECEIVED', 'VERIFIED', 'APPROVED', 'WAIVED'].includes(r.podStatus))
          return (
            <Link href={`/pod/${r.tripId}/verify`} className="btn btn-secondary btn-sm">
              Open
            </Link>
          );
        return can('pod.receive') ? (
          <button className="btn btn-sm" onClick={() => setLogging(r)}>
            Log a receipt
          </button>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            Branch logs receipts
          </span>
        );
      },
    },
  ];

  return (
    <ModuleGuard module="pod">
      <PageHeader
        path="/pod/receiving"
        title="POD receiving register"
        sub="Attachment does not stop the clock. Branch receipt does (BR-49)."
        module="pod"
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Attached in transit', v: data.stats.attachedInTransit },
            { k: 'Received today', v: data.stats.receivedToday },
            { k: 'Awaiting verification', v: data.stats.awaitingVerification },
            { k: 'Awaiting approval', v: data.stats.awaitingApproval },
            { k: 'Balance held', v: inr(data.stats.balanceHeldPaise), tone: 'flag' },
            { k: 'Past 20 days', v: data.stats.pastTwentyDays, tone: 'red' },
          ]}
        />
        <Panel pad={false}>
          <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.tripId} empty="Nothing delivered is waiting." />
        </Panel>
      </Stack>

      <Dialog
        open={!!logging}
        title="Log a POD receipt"
        body="This consumes the PDR- series for your branch and stops the penalty clock on this trip."
        confirmLabel="Log receipt"
        confirmDisabled={!form.courierDocket || !form.receivedOn || !form.pages}
        busy={busy}
        onConfirm={submit}
        onClose={() => setLogging(null)}
      >
        <FormGrid>
          <Field label="Courier docket" required hint="Auto-matches the trip.">
            <input value={form.courierDocket} onChange={(e) => setForm({ ...form, courierDocket: e.target.value })} />
          </Field>
          <Field label="Sent on">
            <input type="date" value={form.sentOn} onChange={(e) => setForm({ ...form, sentOn: e.target.value })} />
          </Field>
          <Field label="Received on" required>
            <input type="date" value={form.receivedOn} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} />
          </Field>
          <Field label="Pages" required>
            <input
              type="number"
              value={form.pages}
              onChange={(e) => setForm({ ...form, pages: Number(e.target.value) })}
            />
          </Field>
          <Field label="Condition">
            <input
              placeholder="Torn, faded, illegible…"
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
            />
          </Field>
        </FormGrid>
      </Dialog>
    </ModuleGuard>
  );
}

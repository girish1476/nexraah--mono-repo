'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { fmtDate, inr } from '@/lib/format';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
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

  /**
   * "E-POD pending" arrives here as `?attached=1`.
   *
   * An e-POD is a proof photographed in the transporter's app whose paper has
   * not reached a branch — which is exactly this register narrowed to the rows
   * already carrying an `attachedAt`. It is a preset rather than a screen of
   * its own for the same reason "past due" is one on `/pod/pending`: a second
   * page would be the same query, the same table and the same receipt dialog,
   * kept in step by hand.
   *
   * Read from `window.location` on mount rather than `useSearchParams()`,
   * which would put this page behind a Suspense boundary at build time for a
   * value it needs once.
   */
  const [attachedOnly, setAttachedOnly] = useState(false);
  useEffect(() => {
    setAttachedOnly(new URLSearchParams(window.location.search).get('attached') === '1');
  }, []);

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
    { key: 'lr', label: 'Lorry receipt', mono: true, render: (r) => r.lrCode ?? '—' },
    {
      key: 'trip',
      label: 'Trip number',
      render: (r) => (
        <Link href={`/trips/${r.tripId}`} className="mono" style={{ fontSize: 12 }}>
          {r.tripCode}
        </Link>
      ),
    },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Route', render: (r) => r.lane },
    { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
    { key: 'docket', label: 'Courier tracking no.', mono: true, render: (r) => r.courierDocket ?? '—' },
    {
      key: 'day',
      label: 'Days waiting',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.ageDays > 40 ? 'var(--red)' : r.ageDays > 20 ? 'var(--flag)' : undefined }}>
          {r.ageDays}
        </span>
      ),
    },
    { key: 'held', label: 'Their money we hold', align: 'right', render: (r) => inr(r.balanceHeldPaise) },
    {
      key: 'state',
      label: 'Delivery proof',
      render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{POD_STATUS_LABEL[r.podStatus] ?? r.podStatus}</Tag>,
    },
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
        title={attachedOnly ? 'E-POD pending' : 'Collect POD'}
        sub="A photo attached in the transporter app does not stop the penalty clock — only logging the physical copy here does."
        module="pod"
      />
      <PageIntro
        what={
          attachedOnly
            ? 'Proofs the transporter has already photographed in their app, whose paper has not reached a branch yet. The photo does not stop the penalty clock — logging the paper here does.'
            : "Every proof of delivery that's been photographed in the transporter app but not yet logged as physically received — check the paper against its courier docket here to stop the penalty clock."
        }
        who="Branch logs each receipt as the physical copy arrives; the photo alone never stops the clock."
      />

      {attachedOnly && (
        <p className="hint" style={{ margin: '-4px 0 16px' }}>
          Showing only proofs that have already been photographed.{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => setAttachedOnly(false)}>
            Show everything waiting to be received
          </button>
        </p>
      )}

      <Stack>
        <StatStrip
          stats={[
            { k: 'Sent, still on the way', id: 'podrecv-in-transit', emoji: '🚚', v: data.stats.attachedInTransit },
            { k: 'Logged in today', id: 'podrecv-logged-today', emoji: '📥', v: data.stats.receivedToday },
            { k: 'To check', id: 'podrecv-to-check', emoji: '🔍', v: data.stats.awaitingVerification },
            { k: 'To approve', id: 'podrecv-to-approve', emoji: '✅', v: data.stats.awaitingApproval },
            { k: 'Transporter money held', id: 'podrecv-money-held', emoji: '🔒', v: inr(data.stats.balanceHeldPaise), tone: 'flag' },
            { k: 'Over 20 days late', id: 'podrecv-over-20-days', emoji: '⏰', v: data.stats.pastTwentyDays, tone: 'red' },
          ]}
        />
        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={
              /*
               * `attachedAt` is what makes a row an e-POD: the transporter has
               * sent a photograph, so the paper is somewhere between them and
               * the branch. A row without one is a delivered trip nobody has
               * photographed at all — a different chase, and a different
               * person to ring.
               */
              attachedOnly ? data.rows.filter((r) => r.attachedAt !== null) : data.rows
            }
            rowKey={(r) => r.tripId}
            empty={
              <EmptyState
                title={attachedOnly ? 'No e-PODs waiting' : 'Nothing waiting to be received'}
                hint={
                  attachedOnly
                    ? 'Nothing has been photographed in the transporter app that is still without its paper. Anything delivered but not yet photographed is on the full list.'
                    : 'A trip lands here once its proof of delivery is attached in the transporter app. Log the physical copy as it arrives by courier to stop the penalty clock.'
                }
              />
            }
          />
        </Panel>
      </Stack>

      <Dialog
        open={!!logging}
        title="Log a POD receipt"
        body="This consumes the PDR- series for your branch and stops the penalty clock on this trip."
        confirmLabel="Log receipt"
        confirmDisabled={!form.courierDocket || !form.sentOn || !form.receivedOn || !form.pages}
        busy={busy}
        onConfirm={submit}
        onClose={() => setLogging(null)}
      >
        <FormGrid>
          <Field label="Courier docket" required hint="Auto-matches the trip.">
            <input value={form.courierDocket} onChange={(e) => setForm({ ...form, courierDocket: e.target.value })} />
          </Field>
          <Field label="Sent on" required hint="Required together with the courier docket (BR-51).">
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

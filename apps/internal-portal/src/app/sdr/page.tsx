'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { WaiverDialog, WaiverEvidence } from '@/components/waiver-dialog';
import { uploadAttachment } from '@/lib/attachments';
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
  StageTabs,
  StatStrip,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { listTrips } from '../trips/apis';
import { TripListRow } from '../trips/types';
import { getSdrSummary, listSdr, raiseSdr, resolveSdr, waiveSdr } from './apis';
import { SDR_KIND_LABEL, SdrKind, SdrRecord, SdrSummary } from './types';

type Tab = 'open' | 'resolved' | 'carried';

const KINDS = Object.keys(SDR_KIND_LABEL) as SdrKind[];

/**
 * SDR — `/sdr`. Shortage and damage records of delivered loads.
 *
 * A record puts the trip's payment on hold. Resolving it fixes the amount taken
 * from the transporter; the payment then goes out after that deduction. When the
 * deduction is bigger than what is left to pay, the rest is carried to the
 * transporter's next orders and taken from those in smaller amounts until it
 * is cleared.
 */
export default function SdrPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<SdrRecord[] | null>(null);
  const [summary, setSummary] = useState<SdrSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');

  const [raising, setRaising] = useState(false);
  const [trips, setTrips] = useState<TripListRow[]>([]);
  const [raiseForm, setRaiseForm] = useState({ tripId: '', kind: 'SHORTAGE' as SdrKind, description: '', claimed: '' });

  const [waiving, setWaiving] = useState<SdrRecord | null>(null);
  const [resolving, setResolving] = useState<SdrRecord | null>(null);
  const [resolveForm, setResolveForm] = useState({ deduction: '', note: '' });
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([listSdr(), getSdrSummary()])
      .then(([r, s]) => {
        setRows(r);
        setSummary(s);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const openRaise = () => {
    setRaiseForm({ tripId: '', kind: 'SHORTAGE', description: '', claimed: '' });
    setRaising(true);
    Promise.all([listTrips({ stage: 'DELIVERED' }), listTrips({ stage: 'CLOSED' })])
      .then(([a, b]) => setTrips([...a, ...b]))
      .catch((e) => toast(errorMessage(e)));
  };

  const submitRaise = async () => {
    setBusy(true);
    try {
      const claimed = Math.round(Number(raiseForm.claimed || 0) * 100);
      const created = await raiseSdr(raiseForm.tripId, {
        kind: raiseForm.kind,
        description: raiseForm.description.trim(),
        claimedAmountPaise: claimed > 0 ? claimed : undefined,
      });
      setRaising(false);
      toast(`${created.code} recorded — the payment for ${created.tripCode} is on hold until it is resolved`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitWaive = async (evidence: WaiverEvidence) => {
    if (!waiving) return;
    setBusy(true);
    try {
      const mailAttachmentId = evidence.file
        ? await uploadAttachment(evidence.file, 'WAIVER_MAIL', 'trips', waiving.tripId)
        : undefined;
      await waiveSdr(waiving.id, { mailSubject: evidence.mailSubject, mailAttachmentId });
      toast(`${waiving.code} — what was left to recover is waived, on Leadership’s mail`);
      setWaiving(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openResolve = (r: SdrRecord) => {
    setResolving(r);
    setResolveForm({ deduction: r.claimedPaise ? String(r.claimedPaise / 100) : '', note: '' });
  };

  const submitResolve = async () => {
    if (!resolving) return;
    setBusy(true);
    try {
      const deductionPaise = Math.round(Number(resolveForm.deduction) * 100);
      const done = await resolveSdr(resolving.id, { deductionPaise, note: resolveForm.note.trim() || undefined });
      setResolving(null);
      toast(
        done.deductionPaise
          ? `${done.code} resolved — ${inr(done.deductionPaise)} comes off the payment, and anything it cannot cover carries to the next orders`
          : `${done.code} resolved with no deduction — the payment is free to go`,
      );
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows || !summary) return <Loading what="Loading shortage and damage records" />;

  const shown = rows.filter((r) =>
    tab === 'open' ? r.status === 'OPEN' : tab === 'resolved' ? r.status === 'RESOLVED' : r.outstandingPaise > 0,
  );

  const columns: Column<SdrRecord>[] = [
    { key: 'code', label: 'Record', mono: true, primary: true, render: (r) => r.code, sub: (r) => fmtDate(r.raisedAt) },
    { key: 'trip', label: 'Trip', mono: true, render: (r) => <Link href={`/trips/${r.tripId}`}>{r.tripCode}</Link> },
    { key: 'vendor', label: 'Transporter', render: (r) => <Link href={`/vendors/${r.vendorId}`}>{r.vendorName}</Link> },
    {
      key: 'kind',
      label: 'What happened',
      render: (r) => (
        <div>
          <Tag tone={r.kind === 'UNLOADING_ACK' ? 'flag' : 'red'}>{SDR_KIND_LABEL[r.kind]}</Tag>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 320 }}>
            {r.description}
          </div>
        </div>
      ),
    },
    { key: 'claimed', label: 'Claimed', align: 'right', render: (r) => (r.claimedPaise ? inr(r.claimedPaise) : '—') },
    {
      key: 'deduction',
      label: 'To deduct',
      align: 'right',
      render: (r) => (r.deductionPaise === null ? <span className="muted">Not decided</span> : inr(r.deductionPaise)),
    },
    {
      key: 'outstanding',
      label: 'Recovery',
      render: (r) =>
        r.status === 'OPEN' ? (
          <span className="muted">—</span>
        ) : (
          <div style={{ minWidth: 200 }}>
            {r.recoveries.map((x) => (
              <div key={`${x.tripId}-${x.at}`} style={{ fontSize: 12 }}>
                <span className="mono">{inr(x.amountPaise)}</span> recovered from trip{' '}
                <Link href={`/trips/${x.tripId}`} className="mono">
                  {x.tripCode}
                </Link>
              </div>
            ))}
            {r.outstandingPaise > 0 && (
              <div style={{ fontSize: 12, color: 'var(--flag)' }}>
                {inr(r.outstandingPaise)} still to recover — a negative balance on the transporter’s account
              </div>
            )}
            {r.waivedPaise > 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                {inr(r.waivedPaise)} waived on Leadership’s mail
              </div>
            )}
            {r.recoveries.length === 0 && r.outstandingPaise === 0 && r.waivedPaise === 0 && (
              <span className="muted">Nothing to recover</span>
            )}
          </div>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        r.status === 'OPEN' ? <Tag tone="red">Payment on hold</Tag> : <Tag tone="mint">Resolved</Tag>,
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {r.status === 'OPEN' && can('pod.approve') && (
            <button className="btn btn-sm" onClick={() => openResolve(r)}>
              Resolve
            </button>
          )}
          {r.status === 'RESOLVED' && r.outstandingPaise > 0 && can('pod.waive') && (
            <button className="btn btn-secondary btn-sm" onClick={() => setWaiving(r)}>
              Waive balance
            </button>
          )}
        </div>
      ),
    },
  ];

  const carried = rows.filter((r) => r.outstandingPaise > 0).length;

  return (
    <ModuleGuard module="pod">
      <PageHeader
        path="/sdr"
        title="SDR"
        sub="Shortage and damage records — what came back short or damaged, and what is recovered from the transporter"
        module="pod"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/vendors/issues" className="btn btn-secondary">
              Complaints log
            </Link>
            {can('pod.verify') && (
              <button className="btn" onClick={openRaise}>
                Record shortage or damage
              </button>
            )}
          </div>
        }
      />
      <PageIntro
        what="The SDR — Shortage Damage Record — of every delivery: each shortage, damage or unloading problem found when it was checked. Until one is resolved, the transporter’s final payment for that trip is on hold. When it is resolved the payment goes out after the deduction, and if the deduction is more than is left to pay, the rest is carried to that transporter’s next orders and taken from them a little at a time."
        who="Whoever checks the proof of delivery records it; the person who approves deliveries decides the amount."
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Payments on hold', id: 'sdr-open', emoji: '⏸️', v: summary.open, tone: summary.open ? 'red' : undefined },
            { k: 'Resolved', id: 'sdr-resolved', emoji: '✅', v: summary.resolved },
            {
              k: 'Still to recover',
              id: 'sdr-carried',
              emoji: '➡️',
              v: inr(summary.outstandingPaise),
              tone: summary.outstandingPaise ? 'flag' : undefined,
            },
          ]}
        />

        <StageTabs
          tabs={[
            { key: 'open', label: 'On hold', count: summary.open, tone: summary.open ? 'red' : undefined },
            { key: 'resolved', label: 'Resolved', count: summary.resolved },
            { key: 'carried', label: 'Still to recover', count: carried },
          ]}
          value={tab}
          onChange={(k) => setTab(k as Tab)}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title={tab === 'open' ? 'No payments on hold' : tab === 'resolved' ? 'Nothing resolved yet' : 'Nothing carried forward'}
                hint={
                  tab === 'open'
                    ? 'When a delivery comes back short or damaged, record it here and the transporter’s payment for that trip waits.'
                    : tab === 'resolved'
                      ? 'Resolved records, and how much of each has been taken so far.'
                      : 'A deduction bigger than the payment it comes off carries here until later payments have covered it.'
                }
              />
            }
          />
        </Panel>
      </Stack>

      <Dialog
        open={raising}
        title="Record shortage or damage"
        body="This holds the transporter’s final payment for the trip until the record is resolved."
        confirmLabel="Record"
        confirmDisabled={!raiseForm.tripId || raiseForm.description.trim().length < 5}
        busy={busy}
        onConfirm={submitRaise}
        onClose={() => setRaising(false)}
      >
        <FormGrid>
          <Field label="Trip" required hint="Only delivered loads can have one.">
            <select value={raiseForm.tripId} onChange={(e) => setRaiseForm({ ...raiseForm, tripId: e.target.value })}>
              <option value="">Choose a trip…</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} · {t.vendorName} · {t.lane}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What happened" required>
            <select value={raiseForm.kind} onChange={(e) => setRaiseForm({ ...raiseForm, kind: e.target.value as SdrKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {SDR_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Details" required hint="What was short or damaged, and how it was noticed.">
            <textarea
              rows={3}
              value={raiseForm.description}
              onChange={(e) => setRaiseForm({ ...raiseForm, description: e.target.value })}
            />
          </Field>
          <Field label="Claimed amount (₹)" hint="Optional — what you believe it costs. The amount actually deducted is decided when it is resolved.">
            <input
              type="number"
              min={0}
              value={raiseForm.claimed}
              onChange={(e) => setRaiseForm({ ...raiseForm, claimed: e.target.value })}
            />
          </Field>
        </FormGrid>
      </Dialog>

      <WaiverDialog
        open={!!waiving}
        title={`Waive what is left · ${waiving?.code ?? ''}`}
        body="This writes off the part of the deduction that has not yet been recovered — the negative balance on the transporter’s account. Leadership approves it by mail; Compliance records it here."
        facts={waiving ? [['Transporter', waiving.vendorName], ['Still to recover', inr(waiving.outstandingPaise)]] : []}
        confirmLabel="Waive balance"
        busy={busy}
        onConfirm={submitWaive}
        onClose={() => setWaiving(null)}
      />

      <Dialog
        open={!!resolving}
        title={`Resolve ${resolving?.code ?? ''}`}
        body="The amount below is taken from the transporter. Their payment for this trip goes out after it. If it is more than is left to pay, the rest carries to their next orders."
        confirmLabel="Resolve"
        confirmDisabled={resolveForm.deduction === '' || !(Number(resolveForm.deduction) >= 0)}
        busy={busy}
        onConfirm={submitResolve}
        onClose={() => setResolving(null)}
      >
        <FormGrid>
          <Field label="Amount to deduct (₹)" required hint="Enter 0 to dismiss the record with no deduction.">
            <input
              type="number"
              min={0}
              value={resolveForm.deduction}
              onChange={(e) => setResolveForm({ ...resolveForm, deduction: e.target.value })}
            />
          </Field>
          <Field label="Note">
            <input value={resolveForm.note} onChange={(e) => setResolveForm({ ...resolveForm, note: e.target.value })} />
          </Field>
        </FormGrid>
      </Dialog>
    </ModuleGuard>
  );
}

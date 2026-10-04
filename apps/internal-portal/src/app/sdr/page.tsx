'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { WaiverDialog, WaiverEvidence } from '@/components/waiver-dialog';
import { uploadAttachment } from '@/lib/attachments';
import { fmtDate, inr } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
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
import { ReportProblemButton } from '../tickets/report-button';
import { getSdrSummary, listSdr, resolveSdr, waiveSdr } from './apis';
import { SDR_KIND_LABEL, SdrRecord, SdrSummary } from './types';

type Tab = 'mismatch' | 'snd' | 'carried';

/** A missing unloading stamp or a document that does not match — not a shortage or a damage. */
const isMismatch = (r: SdrRecord) => r.kind === 'UNLOADING_ACK';

/**
 * SDR — `/sdr`. Shortage and damage records of delivered loads.
 *
 * Nothing is recorded here by hand (owner's direction, 2026-10-03): a record
 * appears on its own when the check of an E-POD or H-POD finds a shortage or
 * damage. This screen is where it is then resolved.
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
  const [tab, setTab] = useState<Tab>('snd');

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
  useLiveRefresh(() =>
    Promise.all([listSdr(), getSdrSummary()]).then(([r, s]) => {
      setRows(r);
      setSummary(s);
    }),
  );

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

  const mismatch = rows.filter(isMismatch);
  const snd = rows.filter((r) => !isMismatch(r));
  const carried = rows.filter((r) => r.outstandingPaise > 0);
  const shown = tab === 'mismatch' ? mismatch : tab === 'snd' ? snd : carried;
  const anyOpen = (list: SdrRecord[]) => list.some((r) => r.status === 'OPEN');

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
          <ReportProblemButton entityType="SDR" entityId={r.code} label="🎫 Raise a ticket" />
        </div>
      ),
    },
  ];

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
            <ReportProblemButton label="🎫 Raise a ticket" className="btn btn-secondary" />
          </div>
        }
      />
      <PageIntro
        what="The SDR — Shortage Damage Record — of every delivery. Nothing is entered here by hand: when a shortage or damage is noted while an E-POD or H-POD is being verified, the record appears here on its own. Until one is resolved, the transporter’s final payment for that trip is on hold. When it is resolved the payment goes out after the deduction, and if the deduction is more than is left to pay, the rest is carried to that transporter’s next orders and taken from them a little at a time."
        who="It comes from whoever verifies the proof of delivery; the person who approves deliveries decides the amount."
      />

      <Stack>
        <StatStrip
          stats={[
            {
              k: 'Details mismatch',
              id: 'sdr-mismatch',
              emoji: '📄',
              v: mismatch.length,
              tone: anyOpen(mismatch) ? 'red' : undefined,
            },
            { k: 'S&D', id: 'sdr-snd', emoji: '📦', v: snd.length, tone: anyOpen(snd) ? 'red' : undefined },
            {
              k: 'Recovery pending',
              id: 'sdr-carried',
              emoji: '➡️',
              v: inr(summary.outstandingPaise),
              tone: summary.outstandingPaise ? 'flag' : undefined,
            },
          ]}
        />

        <StageTabs
          tabs={[
            { key: 'mismatch', label: 'Details Mismatch', count: mismatch.length, tone: anyOpen(mismatch) ? 'red' : undefined },
            { key: 'snd', label: 'S&D', count: snd.length, tone: anyOpen(snd) ? 'red' : undefined },
            { key: 'carried', label: 'Recovery Pending', count: carried.length },
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
                title={tab === 'mismatch' ? 'No details mismatch' : tab === 'snd' ? 'No shortage or damage' : 'Nothing carried forward'}
                hint={
                  tab === 'mismatch'
                    ? 'A missing unloading stamp, or a document that does not match, is recorded here and the transporter’s payment for that trip waits.'
                    : tab === 'snd'
                      ? 'A record appears here when a shortage or damage is noted while a proof of delivery is verified, and the transporter’s payment for that trip waits.'
                      : 'A deduction bigger than the payment it comes off carries here until later payments have covered it.'
                }
              />
            }
          />
        </Panel>
      </Stack>

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

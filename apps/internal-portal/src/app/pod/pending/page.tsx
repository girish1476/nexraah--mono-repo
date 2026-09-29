'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApprovalRequiredError, errorMessage } from '@/apis';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { fmtDate, inr } from '@/lib/format';
import { ROLES } from '@/lib/permissions';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
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
import { getPending, waivePenalty } from '../apis';
import { PendingResponse, PendingRow } from '../types';
import { PodTabs } from '../pod-tabs';

/**
 * Chase list — `/pod/pending` (part 06 §4).
 *
 * Oldest first from the delivery date, with the balance each missing proof is
 * holding. A waiver is proposed here by compliance and approved by
 * leadership; it is never granted at the desk (BR-43).
 */
export default function PodPendingPage() {
  const can = useCan();
  const toast = useToast();
  const [data, setData] = useState<PendingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  const [transporter, setTransporter] = useState('');
  const [ageing, setAgeing] = useState('');

  /**
   * A preset arriving as `?ageing=breached`, so the sidebar can offer "past
   * due" as its own row without a second screen that is this one with a filter
   * pre-set. The filter control below stays live, so somebody who lands on the
   * preset can widen it without going back.
   *
   * Read from `window.location` on mount rather than `useSearchParams()`,
   * which would put this page behind a Suspense boundary at build time for a
   * value it only needs once.
   */
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('ageing');
    if (preset === 'within' || preset === 'breached' || preset === 'forfeited') {
      setAgeing(preset);
    }
  }, []);
  const [waiving, setWaiving] = useState<PendingRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    setData(null);
    getPending({ branch: branch || undefined, transporter: transporter || undefined, ageing: ageing || undefined })
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [branch, transporter, ageing]);

  const submitWaiver = async () => {
    if (!waiving) return;
    setBusy(true);
    try {
      await waivePenalty(waiving.tripId, reason);
      toast('Waiver requested');
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        toast(`Sent to ${ROLES.LEADERSHIP.label} · the penalty keeps accruing until it is approved`);
        setWaiving(null);
        setReason('');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading the chase list" />;

  const columns: Column<PendingRow>[] = [
    {
      key: 'trip',
      label: 'Trip number',
      render: (r) => (
        <div>
          <Link href={`/trips/${r.tripId}`} className="mono" style={{ fontSize: 12 }}>
            {r.tripCode}
          </Link>
          <div className="muted mono" style={{ fontSize: 11 }}>
            {r.lrCode ?? '—'}
          </div>
        </div>
      ),
    },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Route', render: (r) => r.lane },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
    {
      key: 'tat',
      label: 'Days allowed',
      render: (r) =>
        r.forfeited ? (
          <Tag tone="red">Forfeited</Tag>
        ) : r.daysLeft >= 0 ? (
          <Tag tone="mint">{r.daysLeft} days left</Tag>
        ) : (
          <Tag tone="red">+{Math.abs(r.daysLeft)}d over</Tag>
        ),
    },
    {
      key: 'state',
      label: 'Delivery proof',
      render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{POD_STATUS_LABEL[r.podStatus] ?? r.podStatus}</Tag>,
    },
    {
      key: 'penalty',
      label: 'Late penalty',
      align: 'right',
      render: (r) => <span style={{ color: r.penaltyPaise ? 'var(--red)' : undefined }}>{inr(r.penaltyPaise)}</span>,
    },
    { key: 'held', label: 'Their money we hold', align: 'right', render: (r) => inr(r.balanceHeldPaise) },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        can('pod.waive') && r.penaltyPaise > 0 ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setWaiving(r)}>
            Propose waiver
          </button>
        ) : null,
    },
  ];

  return (
    <ModuleGuard module="pod">
      <PageHeader
        path="/pod/pending"
        title="Check POD status"
        sub="Balances held against undelivered proof. ₹100 per day accrues from day 21; past 40 days nothing is payable."
        module="pod"
      />
      <PageIntro
        what="Every trip still missing its proof of delivery, oldest first, with the balance being held and the penalty accruing against each one."
        who="Compliance can propose a penalty waiver here; leadership has to approve it before it actually applies."
      />

      <PodTabs active={ageing === 'breached' ? 'past-due' : null} />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Waiting for proof', id: 'podpending-waiting', emoji: '⏳', v: data.stats.pending },
            { k: 'Past the deadline', id: 'podpending-overdue', emoji: '⏰', v: data.stats.breached, tone: 'red' },
            { k: 'Penalties we can charge', id: 'podpending-penalty', emoji: '⚖️', v: inr(data.stats.penaltyAccruedPaise), tone: 'red' },
            { k: 'Transporter money held', id: 'podpending-money-held', emoji: '🔒', v: inr(data.stats.balanceHeldPaise), tone: 'flag' },
          ]}
        />

        <Panel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 180px' }}>
              <Field label="Branch">
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="All" />
              </Field>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <Field label="Transporter">
                <input value={transporter} onChange={(e) => setTransporter(e.target.value)} placeholder="All" />
              </Field>
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <Field label="Ageing">
                <select value={ageing} onChange={(e) => setAgeing(e.target.value)}>
                  <option value="">All</option>
                  <option value="within">Within turnaround</option>
                  <option value="breached">Breached</option>
                  <option value="forfeited">Past 40 days</option>
                </select>
              </Field>
            </div>
          </div>
        </Panel>

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={data.rows}
            rowKey={(r) => r.tripId}
            empty={
              branch || transporter || ageing ? (
                <EmptyState
                  title="No trips match these filters"
                  hint="Try clearing the branch, transporter or ageing filter — there may still be proofs pending elsewhere."
                  action={
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setBranch('');
                        setTransporter('');
                        setAgeing('');
                      }}
                    >
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="Every proof of delivery is in"
                  hint="No trip is currently missing its proof of delivery, so no balance is being held for one."
                />
              )
            }
          />
        </Panel>
      </Stack>

      <Dialog
        open={!!waiving}
        title="Propose a penalty waiver"
        body="Compliance proposes; leadership approves. The proposal, the approval and the reason are all recorded against the trip. A waived penalty computes as zero when finance releases the balance."
        facts={
          waiving
            ? [
                ['Trip', waiving.tripCode],
                ['Transporter', waiving.vendorName],
                ['Penalty accrued', inr(waiving.penaltyPaise)],
                ['Days over', String(Math.abs(waiving.daysLeft))],
              ]
            : []
        }
        confirmLabel="Request waiver"
        confirmDisabled={reason.trim().length < 30}
        busy={busy}
        onConfirm={submitWaiver}
        onClose={() => setWaiving(null)}
      >
        <Field
          label="Reason"
          required
          hint="At least 30 characters — this goes to leadership for approval, so explain the situation fully."
        >
          <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

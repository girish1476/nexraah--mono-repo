'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { WaiverDialog, WaiverEvidence } from '@/components/waiver-dialog';
import { uploadAttachment } from '@/lib/attachments';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { fmtDate, inr } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { activeFilterCount, emptyFilters, FilterBar, FilterField, FilterValues, matchesAny } from '@/lib/list-filters';
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
import { addDocket, getPending, waivePenalty } from '../apis';
import { PendingResponse, PendingRow } from '../types';
import { PodTabs } from '../pod-tabs';

/**
 * Branch, transporter and ageing are asked of the server (it filters on them);
 * the rest narrow the rows that come back. The labels are what the e2e suite
 * and the sidebar presets already know these boxes by.
 */
const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'Trip, LR, client, city…' },
  { kind: 'text', key: 'branch', label: 'Branch', placeholder: 'All' },
  { kind: 'text', key: 'transporter', label: 'Transporter', placeholder: 'All' },
  {
    kind: 'select',
    key: 'ageing',
    label: 'Ageing',
    allLabel: 'All',
    options: [
      { value: 'within', label: 'Within turnaround' },
      { value: 'breached', label: 'Breached' },
      { value: 'forfeited', label: 'Past 40 days' },
    ],
  },
  { kind: 'text', key: 'clientName', label: 'Client', placeholder: 'Client name' },
  { kind: 'text', key: 'from', label: 'From', placeholder: 'Pick-up city' },
  { kind: 'text', key: 'to', label: 'To', placeholder: 'Delivery city' },
  { kind: 'text', key: 'ref', label: 'Trip or LR number', placeholder: 'Trip or LR number' },
];

/** The lane is stored as one string, "Mumbai → Pune". */
function laneEnds(lane: string): [string, string] {
  const [from = '', to = ''] = lane.split('→').map((x) => x.trim());
  return [from, to];
}

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
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));
  const { branch, transporter, ageing } = filters;

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
  /**
   * "Hard copy pending" arrives as `?copy=pending`: the rows whose paper has
   * not been logged as received (still waiting on the transporter, or photo
   * attached but no paper yet). Rows already received and only awaiting a
   * check or approval drop out — their paper is with us.
   */
  const [hardCopyOnly, setHardCopyOnly] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get('ageing');
    if (preset === 'within' || preset === 'breached' || preset === 'forfeited') {
      setFilters((f) => ({ ...f, ageing: preset }));
    }
    setHardCopyOnly(params.get('copy') === 'pending');
  }, []);
  const [docketFor, setDocketFor] = useState<PendingRow | null>(null);
  const [docketNo, setDocketNo] = useState('');
  const [waiving, setWaiving] = useState<PendingRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    getPending({ branch: branch || undefined, transporter: transporter || undefined, ageing: ageing || undefined })
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [branch, transporter, ageing]);
  useLiveRefresh(() =>
    getPending({ branch: branch || undefined, transporter: transporter || undefined, ageing: ageing || undefined }).then(
      setData,
    ),
  );

  const submitWaiver = async (evidence: WaiverEvidence) => {
    if (!waiving) return;
    setBusy(true);
    try {
      const mailAttachmentId = evidence.file
        ? await uploadAttachment(evidence.file, 'WAIVER_MAIL', 'trips', waiving.tripId)
        : undefined;
      await waivePenalty(waiving.tripId, { kind: 'POD_PENALTY', mailSubject: evidence.mailSubject, mailAttachmentId });
      toast(`Penalty waived for ${waiving.tripCode} · recorded against Leadership’s mail`);
      setWaiving(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDocket = async () => {
    if (!docketFor) return;
    setBusy(true);
    try {
      await addDocket(docketFor.tripId, { docketNo: docketNo.trim() });
      toast(`Docket ${docketNo.trim()} recorded — ${docketFor.tripCode} comes off the hard-copy follow-up`);
      setDocketFor(null);
      setDocketNo('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(
    () =>
      (data?.rows ?? [])
        // Once a courier docket is on record the paper is on its way, so the
        // delivery is no longer one to chase for its hard copy.
        .filter((r) => !hardCopyOnly || ((r.podStatus === 'PENDING' || r.podStatus === 'ATTACHED') && !r.docketNo))
        .filter((r) => {
          const [from, to] = laneEnds(r.lane);
          return (
            matchesAny(filters.q, r.tripCode, r.lrCode, r.clientName, r.lane, r.vendorName) &&
            matchesAny(filters.clientName, r.clientName) &&
            matchesAny(filters.from, from) &&
            matchesAny(filters.to, to) &&
            matchesAny(filters.ref, r.tripCode, r.lrCode)
          );
        }),
    [data, hardCopyOnly, filters],
  );

  const exportRows = async () => {
    downloadCsv(
      `proof-of-delivery-pending-${todayStamp()}.csv`,
      ['Trip', 'LR', 'Client', 'From', 'To', 'Transporter', 'Branch', 'Delivered on', 'Days since delivery', 'Days left (negative = over)', 'Proof status', 'Penalty (INR)', 'Money we hold (INR)'],
      visible.map((r) => {
        const [from, to] = laneEnds(r.lane);
        return [
          r.tripCode, r.lrCode, r.clientName, from, to, r.vendorName, r.branchName, r.deliveredAt?.slice(0, 10),
          r.ageDays, r.daysLeft, POD_STATUS_LABEL[r.podStatus] ?? r.podStatus, r.penaltyPaise / 100, r.balanceHeldPaise / 100,
        ];
      }),
    );
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
    {
      key: 'docket',
      label: 'Courier docket',
      render: (r) =>
        r.docketNo ? (
          <span>
            <span className="mono" style={{ fontSize: 12 }}>
              {r.docketNo}
            </span>
            {can('pod.receive') && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 6 }}
                onClick={() => {
                  setDocketNo(r.docketNo ?? '');
                  setDocketFor(r);
                }}
              >
                Edit
              </button>
            )}
          </span>
        ) : can('pod.receive') ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setDocketFor(r)}>
            Add docket
          </button>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: 'held', label: 'Their money we hold', align: 'right', render: (r) => inr(r.balanceHeldPaise) },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        can('pod.waive') && r.penaltyPaise > 0 ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setWaiving(r)}>
            Waive penalty
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

      <PodTabs active={hardCopyOnly ? 'hard-copy' : null} />

      {hardCopyOnly && (
        <p className="hint" style={{ margin: '-4px 0 16px' }}>
          Showing only deliveries whose paper copy has not reached a branch yet — oldest first, so the
          overdue ones are at the top.{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => setHardCopyOnly(false)}>
            Show every trip missing proof
          </button>
        </p>
      )}

      <Stack>
        <StatStrip
          stats={[
            { k: 'Waiting for proof', id: 'podpending-waiting', emoji: '⏳', v: data.stats.pending },
            { k: 'Past the deadline', id: 'podpending-overdue', emoji: '⏰', v: data.stats.breached, tone: 'red' },
            { k: 'Penalties we can charge', id: 'podpending-penalty', emoji: '⚖️', v: inr(data.stats.penaltyAccruedPaise), tone: 'red' },
            { k: 'Transporter money held', id: 'podpending-money-held', emoji: '🔒', v: inr(data.stats.balanceHeldPaise), tone: 'flag' },
          ]}
        />

        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={setFilters}
          onExport={exportRows}
          resultNote={`${visible.length} trip${visible.length === 1 ? '' : 's'} found`}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.tripId}
            empty={
              activeFilterCount(filters) > 0 ? (
                <EmptyState
                  title="No trips match these filters"
                  hint="Loosen one of the boxes above, or use Clear to start again — there may still be proofs pending elsewhere."
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
        open={!!docketFor}
        title={docketFor?.docketNo ? 'Change courier docket' : 'Add courier docket'}
        body="The docket number is the proof the paper was sent — optional, and it can be corrected. Once one is on record, this delivery no longer needs chasing for its hard copy."
        facts={docketFor ? [['Trip', docketFor.tripCode], ['Transporter', docketFor.vendorName]] : []}
        confirmLabel="Record docket"
        confirmDisabled={docketNo.trim().length < 3}
        busy={busy}
        onConfirm={submitDocket}
        onClose={() => setDocketFor(null)}
      >
        <Field label="Courier docket number" required>
          <input value={docketNo} onChange={(e) => setDocketNo(e.target.value)} />
        </Field>
      </Dialog>

      <WaiverDialog
        open={!!waiving}
        title="Waive the paperwork penalty"
        body="Leadership approves a waiver by mail; Compliance records it here. The mail’s subject is kept as the evidence, and the penalty computes as zero when Finance releases the balance."
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
        confirmLabel="Waive penalty"
        busy={busy}
        onConfirm={submitWaiver}
        onClose={() => setWaiving(null)}
      />
    </ModuleGuard>
  );
}

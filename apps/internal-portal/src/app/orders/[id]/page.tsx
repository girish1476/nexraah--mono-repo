'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { BalancePanel } from '@/components/balance-panel';
import { getTracking, getTripDocuments } from '@/app/trips/apis';
import type { TrackingSheet, TripDocument } from '@/app/trips/types';
import { docLabel } from '@/lib/documents';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import {
  Column,
  DataTable,
  EmptyState,
  ErrorState,
  FactList,
  Journey,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Split,
  Stack,
  Tag,
} from '@/lib/ui';
import { getOrder } from '../apis';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, OrderDetail } from '../types';
import { OrderCommentsButton } from './comments-button';
import { OrderDocumentsTab } from './documents-tab';
import { OrderInvoiceTab } from './invoice-tab';
import { OrderMoney } from './order-money';
import { OrderNextStep, type OrderTabTarget } from './next-step';
import { KIND_LABEL as TRACKING_KIND_LABEL, OrderTrackingTab } from './tracking-tab';

type OrderTab = 'details' | 'documents' | 'tracking';

const TABS: { key: OrderTab; label: string; emoji: string }[] = [
  { key: 'details', label: 'Details', emoji: '📋' },
  { key: 'documents', label: 'Documents', emoji: '📎' },
  { key: 'tracking', label: 'Tracking', emoji: '🧭' },
];

/** A dead end outside the normal ten steps — the ladder shows it as stuck
 *  rather than "done", the same way `JourneyMini` on the orders list does. */
const STUCK_STATUSES: OrderDetail['status'][] = ['FAILED', 'POD_FORFEITED'];

const DOC_STATE: Record<string, { tone: 'mint' | 'flag' | 'red' | 'grey'; label: string }> = {
  MISSING: { tone: 'grey', label: 'Not uploaded' },
  PENDING: { tone: 'flag', label: 'Waiting for check' },
  VERIFIED: { tone: 'mint', label: 'Verified' },
  REJECTED: { tone: 'red', label: 'Rejected' },
};

/**
 * `/orders/[id]` — the whole lifecycle of one order, one screen, one URL.
 *
 * Three tabs, as the operations team asked (30 Sep 2026):
 *
 * - **Details** — everything about the order: the next step and the button
 *   that does it, where it loads and delivers, the transporter and truck, the
 *   payments and the client invoice, which documents are uploaded and who
 *   checked them, and the latest tracking.
 * - **Documents** — each document's photo (or the vehicle PDF) beside the
 *   details written on it; the lorry receipt if the load needs one; the proof
 *   of delivery once the truck is unloaded, as an E-POD or an H-POD.
 * - **Tracking** — the tracking sheet and the map, from "on the way to the
 *   loading point" to "unloaded".
 *
 * Comments are the 💬 button in the header, not a tab.
 */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<OrderTab>('details');
  const [lrCode, setLrCode] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getOrder(id).then(setOrder).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const openTab = (target: OrderTabTarget | OrderTab) => {
    setTab(target);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!order) return <Loading what="Loading the order" />;

  return (
    <ModuleGuard module="orders">
      <PageHeader
        title={order.indentCode}
        sub={`${order.clientName} · ${order.lane}${order.tripCode ? ` · trip ${order.tripCode}` : ''}${
          order.vehicleNo ? ` · 🚛 ${order.vehicleNo}` : ''
        }`}
        module="orders"
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Tag tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Tag>
            <OrderCommentsButton orderId={order.id} remarks={order.remarks} initial={order.comments ?? []} />
          </div>
        }
      />
      <PageIntro
        what="Everything about one order on a single screen — where it stands and the button for the next step, its documents, and where the truck is."
        who="Every desk can open this. Operations moves the load forward; Compliance checks the documents; Finance releases the payments."
      />

      {/* The record IDs one order is known by, who it's for, and where it's going. */}
      <div className="record-status" style={{ marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Indent</div>
          <div className="record-status-value">
            <Link href={`/indents/${order.indentId}`}>{order.indentCode}</Link>
          </div>
        </div>
        <div>
          <div className="eyebrow">Trip</div>
          <div className="record-status-value">
            {order.tripId ? <Link href={`/trips/${order.tripId}`}>{order.tripCode}</Link> : <span className="muted">Not generated yet</span>}
          </div>
        </div>
        {order.tripId && (
          <div>
            <div className="eyebrow">LR</div>
            <div className="record-status-value">
              {lrCode ? <Link href={`/trips/${order.tripId}/lr`}>{lrCode}</Link> : <span className="muted">Not issued</span>}
            </div>
          </div>
        )}
        {/* The truck carrying it — the one fact people ask for most once a vehicle is allocated. */}
        <div>
          <div className="eyebrow">Truck</div>
          <div className="record-status-value">
            {order.vehicleNo ? (
              <span className="mono" style={{ letterSpacing: '0.02em' }}>
                {order.vehicleNo}
              </span>
            ) : (
              <span className="muted">Not allocated</span>
            )}
          </div>
          {order.vehicleNo && (order.driverName || order.driverPhone) && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {[order.driverName, order.driverPhone].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div>
          <div className="eyebrow">Customer</div>
          <div className="record-status-value">{order.clientName}</div>
        </div>
        <div>
          <div className="eyebrow">Route</div>
          <div className="record-status-value">
            {order.fromCity} → {order.toCity}
          </div>
        </div>
        {order.invoiceCode && (
          <div>
            <div className="eyebrow">Invoice</div>
            <div className="record-status-value">
              <Link href={`/invoices/${order.invoiceId}`}>{order.invoiceCode}</Link>
            </div>
          </div>
        )}
      </div>

      <div className="stage-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'stage-tab is-active' : 'stage-tab'}
            onClick={() => setTab(t.key)}
          >
            <span className="glyph" aria-hidden>
              {t.emoji}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab order={order} reload={load} openTab={openTab} />}

      {tab === 'documents' &&
        (order.tripId ? (
          <OrderDocumentsTab tripId={order.tripId} onChanged={load} openTracking={() => openTab('tracking')} onLrLoaded={setLrCode} />
        ) : (
          <EmptyState
            title="No documents yet"
            hint="Documents open up once a transporter is awarded and a trip is generated for this order."
          />
        ))}

      {tab === 'tracking' &&
        (order.tripId ? (
          <OrderTrackingTab tripId={order.tripId} onChanged={load} openDocuments={() => openTab('documents')} />
        ) : (
          <EmptyState
            title="Tracking starts once a vehicle is allocated"
            hint="Award the load to a transporter and allocate the truck from the Next step on the Details tab."
          />
        ))}
    </ModuleGuard>
  );
}

function DetailsTab({
  order,
  reload,
  openTab,
}: {
  order: OrderDetail;
  reload: () => void;
  openTab: (t: OrderTabTarget | OrderTab) => void;
}) {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Panel title="🚚 Order stage">
          <Journey step={order.stepNo} stuck={STUCK_STATUSES.includes(order.status)} />
        </Panel>
      </div>

      <div style={{ marginBottom: 16 }}>
        <OrderNextStep order={order} onChanged={reload} openTab={openTab} />
      </div>

      <Split
        aside={
          order.tripId && (
            <>
              <AdvancePanel indentId={order.indentId} onReleased={reload} hideOrderLink />
              <BalancePanel tripId={order.tripId} onReleased={reload} hideOrderLink />
            </>
          )
        }
      >
        {/* Side by side; one under the other when the page is too narrow for both. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <Panel title="📦 Order" pad={false}>
            <FactList
              facts={[
                ['Client', order.clientName],
                ['Material', order.material],
                ['Weight', `${order.weightTn} MT`],
                ['Truck type', order.truckType],
                ['Pickup date', fmtDate(order.pickupDate)],
                ['Branch', order.branchName],
                ['Freight (sell)', inr(order.sellRatePaise)],
                ['Freight (buy)', order.buyRatePaise !== null ? inr(order.buyRatePaise) : 'not awarded yet'],
              ]}
            />
          </Panel>

          <Panel title="📍 From and to" pad={false}>
            <FactList
              facts={[
                ['From', order.fromCity],
                ['Loading address', order.pickupAddress || <span className="muted">Not given on the load request</span>],
                ['To', order.toCity],
                ['Unloading address', order.dropAddress || <span className="muted">Not given on the load request</span>],
              ]}
            />
          </Panel>
        </div>

        <Panel title="🚛 Transporter and vehicle" pad={false}>
          <FactList
            facts={[
              ['Transporter', order.vendorName ?? <span className="muted">Not awarded yet</span>],
              ['Transporter code', order.vendorCode ?? '—'],
              ['Transporter phone', order.vendorPhone ?? '—'],
              ['Vehicle', order.vehicleNo || <span className="muted">Not allocated yet</span>],
              ['Driver mobile', order.driverPhone ? <a href={`tel:${order.driverPhone}`}>{order.driverPhone}</a> : '—'],
              ['Driver', order.driverName ?? '—'],
            ]}
          />
        </Panel>

        {order.tripId && <TrackingSummary tripId={order.tripId} status={order.status} openTracking={() => openTab('tracking')} />}

        {order.tripId && <DocumentStatus tripId={order.tripId} openDocuments={() => openTab('documents')} />}

        <OrderMoney order={order} />

        <OrderInvoiceTab order={order} />

        <Panel title="🕘 What has happened so far">
          <Stack gap={0}>
            {order.events.length === 0 && <div className="hint">Nothing recorded yet. Steps appear here as the order moves.</div>}
            {order.events.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', gap: 12, paddingBottom: i === order.events.length - 1 ? 0 : 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                  <div
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: '50%',
                      flex: 'none',
                      background: m.status === 'FAILED' ? 'var(--red)' : 'var(--mint)',
                      border: `2px solid ${m.status === 'FAILED' ? 'var(--red)' : 'var(--mint)'}`,
                    }}
                  />
                  {i < order.events.length - 1 && (
                    <div style={{ width: 2, flex: 1, minHeight: 18, background: 'var(--color-divider)', marginTop: 2 }} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>{ORDER_STATUS_LABEL[m.status]}</div>
                  <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 1 }}>
                    {fmtDate(m.at)}
                    {` · ${m.actorName ?? 'automatic'}`}
                  </div>
                  {m.note && (
                    <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 1 }}>
                      {m.note}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Stack>
        </Panel>
      </Split>
    </>
  );
}

/** The latest line of the tracking sheet and the milestones reached, on Details. */
function TrackingSummary({ tripId, status, openTracking }: { tripId: string; status: string; openTracking: () => void }) {
  const [sheet, setSheet] = useState<TrackingSheet | null>(null);
  useEffect(() => {
    getTracking(tripId).then(setSheet).catch(() => setSheet(null));
  }, [tripId, status]);
  const latest = sheet ? [...sheet.updates].reverse()[0] : undefined;
  // The last few lines of the sheet, newest first, with who made each.
  const recent = sheet ? [...sheet.updates].reverse().slice(0, 5) : [];
  return (
    <Panel
      title="📍 Vehicle tracking"
      right={
        <button className="btn btn-secondary btn-sm" onClick={openTracking}>
          Open Tracking
        </button>
      }
      pad={false}
    >
      <FactList
        facts={[
          ['Reached loading point', sheet?.reachedLoadingAt ? fmtDateTime(sheet.reachedLoadingAt) : '—'],
          ['Loaded', sheet?.loadedAt ? fmtDateTime(sheet.loadedAt) : '—'],
          ['On the road since', sheet?.departedAt ? fmtDateTime(sheet.departedAt) : '—'],
          ['Reached unloading point', sheet?.reachedDestinationAt ? fmtDateTime(sheet.reachedDestinationAt) : '—'],
          ['Unloaded', sheet?.deliveredAt ? fmtDateTime(sheet.deliveredAt) : '—'],
          [
            'Last update',
            latest ? `${latest.location} · ${fmtDateTime(latest.recordedAt)}${latest.note ? ` · ${latest.note}` : ''}` : 'Nothing yet',
          ],
          ['Last updated by', latest?.recordedByName ?? '—'],
        ]}
      />
      {recent.length > 0 && (
        <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
          <div className="muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, margin: 'var(--space-2) 0' }}>
            Tracking updated by
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-sm)', display: 'grid', gap: 4 }}>
            {recent.map((u) => (
              <li key={u.id}>
                {TRACKING_KIND_LABEL[u.kind] ?? u.kind}
                {u.location ? ` · ${u.location}` : ''} — <strong>{u.recordedByName ?? 'automatic'}</strong>
                <span className="muted"> · {fmtDateTime(u.recordedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Which documents are uploaded, and who checked them — the record, kept off the Documents tab. */
function DocumentStatus({ tripId, openDocuments }: { tripId: string; openDocuments: () => void }) {
  const [docs, setDocs] = useState<TripDocument[] | null>(null);
  useEffect(() => {
    getTripDocuments(tripId).then(setDocs).catch(() => setDocs([]));
  }, [tripId]);
  const rows = (docs ?? []).filter((d) => d.kind !== 'POD');
  const columns: Column<TripDocument>[] = [
    { key: 'doc', label: 'Document', render: (r) => r.label || docLabel(r.kind) },
    {
      key: 'up',
      label: 'Uploaded by',
      render: (r) =>
        r.uploadedAt ? `${r.uploadedBy ?? '—'} · ${fmtDateTime(r.uploadedAt)}` : <span className="muted">Not uploaded</span>,
    },
    {
      key: 'ver',
      label: 'Verified by',
      render: (r) => (r.verifiedBy ? `${r.verifiedBy} · ${fmtDateTime(r.verifiedAt)}` : <span className="muted">—</span>),
    },
    {
      key: 'state',
      label: 'State',
      render: (r) => <Tag tone={DOC_STATE[r.status]?.tone ?? 'grey'}>{DOC_STATE[r.status]?.label ?? r.status}</Tag>,
    },
  ];
  return (
    <Panel
      title="📎 Documents — uploaded and verified"
      right={
        <button className="btn btn-secondary btn-sm" onClick={openDocuments}>
          Open Documents
        </button>
      }
      pad={false}
    >
      {docs === null ? <Loading what="Loading documents" /> : <DataTable columns={columns} rows={rows} rowKey={(r) => r.kind} />}
    </Panel>
  );
}

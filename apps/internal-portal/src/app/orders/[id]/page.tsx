'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { BalancePanel } from '@/components/balance-panel';
import { getTrip, getTripDocuments } from '@/app/trips/apis';
import type { TripDocument } from '@/app/trips/types';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import {
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
  useCan,
} from '@/lib/ui';
import { getOrder } from '../apis';
import { OrderActivityList } from './activity-list';
import { CorrectVehicleButton } from './correct-vehicle';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, OrderDetail } from '../types';
import { OrderCommentsButton } from './comments-button';
import { OrderDocumentsTab } from './documents-tab';
import { OrderInvoiceTab } from './invoice-tab';
import { OrderMoney } from './order-money';
import { OrderNextStep, type OrderTabTarget } from './next-step';
import { OrderTrackingTab } from './tracking-tab';

type OrderTab = 'details' | 'documents' | 'tracking';

const TABS: { key: OrderTab; label: string; emoji: string }[] = [
  { key: 'details', label: 'Details', emoji: '📋' },
  { key: 'documents', label: 'Documents', emoji: '📎' },
  { key: 'tracking', label: 'Tracking', emoji: '🧭' },
];

/** A dead end outside the normal ten steps — the ladder shows it as stuck
 *  rather than "done", the same way `JourneyMini` on the orders list does. */
const STUCK_STATUSES: OrderDetail['status'][] = ['FAILED', 'POD_FORFEITED'];

/** The steps before unloading — while a mistyped truck number can still be corrected. */
const VEHICLE_CORRECTABLE: OrderDetail['status'][] = [
  'INDENT_CREATED',
  'TRIP_GENERATED',
  'LR_ISSUED',
  'ADVANCE_DOCS_UPLOADED',
  'ADVANCE_PAID',
  'TRACKING',
];

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
  const [slipLrNo, setSlipLrNo] = useState<string | null>(null);
  const can = useCan();

  const load = () => {
    setError(null);
    getOrder(id).then(setOrder).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  // The LR this order goes by: the E-LR when one is issued, else the number
  // typed off the loading slip. Read again whenever the order is reloaded.
  const tripId = order?.tripId;
  useEffect(() => {
    if (!tripId) return;
    getTrip(tripId)
      .then((t) => setLrCode(t.lr?.code ?? null))
      .catch(() => undefined);
    getTripDocuments(tripId)
      .then((docs) => {
        const raw = docs.find((d) => d.kind === 'LOADING_SLIP')?.keyedValues?.lrNo;
        setSlipLrNo(raw ? String(raw) : null);
      })
      .catch(() => undefined);
  }, [tripId, order]);

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

      {/* The record IDs one order is known by, who it's for, and where it's going — said here once, not also under the title. */}
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
              {lrCode ? (
                <Link href={`/trips/${order.tripId}/lr`}>{lrCode}</Link>
              ) : slipLrNo ? (
                <span className="mono">{slipLrNo}</span>
              ) : (
                <span className="muted">Not issued</span>
              )}
            </div>
          </div>
        )}
        {/* The truck carrying it — the one fact people ask for most once a vehicle is allocated. */}
        <div>
          <div className="eyebrow">Truck</div>
          <div className="record-status-value">
            {order.vehicleNo ? (
              <>
                <span className="mono" style={{ letterSpacing: '0.02em' }}>
                  {order.vehicleNo}
                </span>
                {/* A mistyped number can be put right until the truck is unloaded. */}
                {can('indent.manage') && VEHICLE_CORRECTABLE.includes(order.status) && (
                  <CorrectVehicleButton indentId={order.indentId} vehicleNo={order.vehicleNo} onCorrected={load} />
                )}
              </>
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
          <OrderTrackingTab tripId={order.tripId} status={order.status} onChanged={load} openDocuments={() => openTab('documents')} />
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
            inline
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

        <OrderActivityList order={order} />
      </Split>
    </>
  );
}

/** Who uploaded the advance documents, and who checked them — the record, kept off the Documents tab. */
function DocumentStatus({ tripId, openDocuments }: { tripId: string; openDocuments: () => void }) {
  const [docs, setDocs] = useState<TripDocument[] | null>(null);
  useEffect(() => {
    getTripDocuments(tripId).then(setDocs).catch(() => setDocs([]));
  }, [tripId]);
  const advance = (docs ?? []).filter((d) => d.gatesAdvance);
  // One line for the whole set: everyone who did it, and when the last one was done.
  const summary = (by: (d: TripDocument) => string | null | undefined, at: (d: TripDocument) => string | null) => {
    const done = advance.filter((d) => at(d));
    if (done.length === 0) return '—';
    const names = [...new Set(done.map((d) => by(d) ?? '—'))].join(', ');
    const last = done.map((d) => at(d) as string).sort().pop() as string;
    const count = done.length < advance.length ? ` · ${done.length} of ${advance.length}` : '';
    return `${names} · ${fmtDateTime(last)}${count}`;
  };
  return (
    <Panel
      title="📎 Advance documents"
      right={
        <button className="btn btn-secondary btn-sm" onClick={openDocuments}>
          Open Documents
        </button>
      }
      pad={false}
    >
      {docs === null ? (
        <Loading what="Loading documents" />
      ) : (
        <FactList
          facts={[
            ['Advance documents uploaded by', summary((d) => d.uploadedBy, (d) => d.uploadedAt)],
            ['Advance documents verified by', summary((d) => d.verifiedBy, (d) => d.verifiedAt)],
          ]}
        />
      )}
    </Panel>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { BalancePanel } from '@/components/balance-panel';
import { TripTrackingPanel } from '@/components/trip-tracking-panel';
import { LorryReceiptContent } from '@/app/trips/[id]/lr/content';
import { TripDocumentsContent } from '@/app/trips/[id]/documents/content';
import { PodVerifyContent } from '@/app/pod/[id]/verify/content';
import { fmtDate, inr } from '@/lib/format';
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
} from '@/lib/ui';
import { getOrder } from '../apis';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, OrderDetail } from '../types';
import { OrderCommentsButton } from './comments-button';
import { OrderInvoiceTab } from './invoice-tab';
import { OrderMoney } from './order-money';
import { OrderNextStep, type OrderTabTarget } from './next-step';

type OrderTab = 'details' | 'documents' | 'invoice';

const TABS: { key: OrderTab; label: string; emoji: string }[] = [
  { key: 'details', label: 'Details', emoji: '📋' },
  { key: 'documents', label: 'Documents', emoji: '📎' },
  { key: 'invoice', label: 'Invoice', emoji: '🧾' },
];

/** A dead end outside the normal ten steps — the ladder shows it as stuck
 *  rather than "done", the same way `JourneyMini` on the orders list does. */
const STUCK_STATUSES: OrderDetail['status'][] = ['FAILED', 'POD_FORFEITED'];

/** Where the truck is, read off the order's step — for the tracking panel's wording. */
function tripStageOf(status: OrderDetail['status']): string {
  if (status === 'TRACKING') return 'IN_TRANSIT';
  if (['UNLOADED', 'POD_UPLOADED', 'POD_VERIFIED', 'BALANCE_RELEASED', 'POD_FORFEITED'].includes(status)) return 'DELIVERED';
  return 'OPEN';
}

/**
 * `/orders/[id]` — the whole lifecycle of one order, one screen, one URL.
 *
 * Reworked 2026-09-30 from the operations team's notes:
 *
 * - **The order moves from here.** A "Next step" panel names what is left to
 *   do and carries the button that does it — award, allocate the vehicle,
 *   start the trip, mark it delivered — instead of sending people to the
 *   indent or trip page and leaving the order looking stuck.
 * - **Payments are on Details** (what went out, with UTRs, beside the advance
 *   and balance panels that release it), and **tracking** is there too while
 *   the truck is on the road.
 * - **Delivery proof lives with the documents.** One Documents tab holds the
 *   lorry receipt, the trip's documents and the proof of delivery.
 * - **The old Payments tab is now Invoice** — the client's side of the money,
 *   which the page never showed.
 * - **Comments are a small 💬 button** in the header where remarks can be
 *   added, not a tab that could only show what was typed at the start.
 *
 * `TripDocumentsContent`, `PodVerifyContent` and `LorryReceiptContent` are the
 * exact components the standalone trip, POD and LR routes render — one upload
 * workflow and one verify workflow, not copies.
 */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<OrderTab>('details');
  // Mirrored up from the embedded `LorryReceiptContent` (its own `onLoaded`
  // callback) so the header strip can show the LR number without a second
  // fetch — null until the Documents tab has loaded it at least once.
  const [lrCode, setLrCode] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getOrder(id).then(setOrder).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const openTab = (target: OrderTabTarget) => {
    setTab(target);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!order) return <Loading what="Loading the order" />;

  return (
    <ModuleGuard module="orders">
      <PageHeader
        title={order.indentCode}
        sub={`${order.clientName} · ${order.lane}${order.tripCode ? ` · trip ${order.tripCode}` : ''}`}
        module="orders"
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Tag tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Tag>
            <OrderCommentsButton orderId={order.id} remarks={order.remarks} initial={order.comments ?? []} />
          </div>
        }
      />
      <PageIntro
        what="Everything about one order on a single screen — where it stands, the next thing to do and the button that does it, its documents and delivery proof, and its invoice."
        who="Every desk can open this. Operations moves the load forward from the Next step panel; only Finance can release the advance or balance payment shown here."
      />

      {/* The three record IDs one order is known by, who it's for, and where
          it's going — "which order is this" before reading any tab. */}
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
              ) : (
                <span className="muted">Not issued yet</span>
              )}
            </div>
          </div>
        )}
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
              <a
                href="#invoice"
                onClick={(e) => {
                  e.preventDefault();
                  openTab('invoice');
                }}
              >
                {order.invoiceCode}
              </a>
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

      {tab === 'details' && (
        <>
          {/* Past, current and still-to-come steps together. FAILED never
              reaches step 2, so the ladder renders it as stuck rather than a
              step quietly skipped. */}
          <div style={{ marginBottom: 16 }}>
            <Panel title="🚚 Order stage">
              <Journey step={order.stepNo} stuck={STUCK_STATUSES.includes(order.status)} />
            </Panel>
          </div>

          <div style={{ marginBottom: 16 }}>
            <OrderNextStep order={order} onChanged={load} openTab={openTab} />
          </div>

          <Split
            aside={
              order.tripId && (
                <>
                  <AdvancePanel indentId={order.indentId} onReleased={load} hideOrderLink />
                  <BalancePanel tripId={order.tripId} onReleased={load} hideOrderLink />
                </>
              )
            }
          >
            <Panel title="Order" pad={false}>
              <FactList
                facts={[
                  ['Client', order.clientName],
                  ['Lane', order.lane],
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

            {order.vendorName && (
              <Panel title="Vendor and vehicle" pad={false}>
                <FactList
                  facts={[
                    ['Vendor', order.vendorName],
                    ['Vehicle', order.vehicleNo || 'not allocated yet'],
                    [
                      'Driver mobile',
                      order.driverPhone ? <a href={`tel:${order.driverPhone}`}>{order.driverPhone}</a> : '—',
                    ],
                    ['Driver', order.driverName ?? '—'],
                  ]}
                />
              </Panel>
            )}

            {order.tripId && <TripTrackingPanel vehicleNo={order.vehicleNo || null} tripStage={tripStageOf(order.status)} />}

            <OrderMoney order={order} />

            {/*
              What actually happened, in the order it happened. Recorded
              `order_events`: one row per entry into a step, appended, never
              overwritten.
            */}
            <Panel title="🕘 What has happened so far">
              <Stack gap={0}>
                {order.events.length === 0 && (
                  <div className="hint">Nothing recorded yet. Steps appear here as the order moves.</div>
                )}
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
                    <div style={{ paddingTop: 0 }}>
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
      )}

      {tab === 'documents' &&
        (order.tripId ? (
          <Stack>
            <Panel title="Lorry receipt" pad={false}>
              <div style={{ padding: 15 }}>
                <LorryReceiptContent tripId={order.tripId} onLoaded={(d) => setLrCode(d.lr.code)} />
              </div>
            </Panel>
            <Panel title="Documents" pad={false}>
              <div style={{ padding: 15 }}>
                <TripDocumentsContent tripId={order.tripId} />
              </div>
            </Panel>
            {/* Delivery proof is a document too — it is uploaded, received and
                checked here, with the rest of the order's paperwork. */}
            <Panel title="📸 Delivery proof" pad={false}>
              <div style={{ padding: 15 }}>
                {['UNLOADED', 'POD_UPLOADED', 'POD_VERIFIED', 'BALANCE_RELEASED', 'POD_FORFEITED'].includes(order.status) ? (
                  <PodVerifyContent tripId={order.tripId} showOrderLink={false} showStatusTag={false} />
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                    The delivery proof is uploaded here once the truck is marked delivered.
                  </p>
                )}
              </div>
            </Panel>
          </Stack>
        ) : (
          <EmptyState
            title="No documents yet"
            hint="Documents, the lorry receipt and the delivery proof open up once a transporter is awarded and a trip is generated for this order."
          />
        ))}

      {tab === 'invoice' && <OrderInvoiceTab order={order} />}
    </ModuleGuard>
  );
}

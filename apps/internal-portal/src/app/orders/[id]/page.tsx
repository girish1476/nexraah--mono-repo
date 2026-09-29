'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { BalancePanel } from '@/components/balance-panel';
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
import { OrderPaymentsTab } from './payments-tab';

type OrderTab = 'details' | 'documents' | 'proof' | 'payments' | 'comments';

const TABS: { key: OrderTab; label: string; emoji: string }[] = [
  { key: 'details', label: 'Details', emoji: '📋' },
  { key: 'documents', label: 'Documents', emoji: '📎' },
  { key: 'proof', label: 'Delivery proof', emoji: '📸' },
  { key: 'payments', label: 'Payments', emoji: '💰' },
  { key: 'comments', label: 'Comments', emoji: '💬' },
];

/** A dead end outside the normal ten steps — the ladder shows it as stuck
 *  rather than "done", the same way `JourneyMini` on the orders list does. */
const STUCK_STATUSES: OrderDetail['status'][] = ['FAILED', 'POD_FORFEITED'];

/**
 * `/orders/[id]` — the whole lifecycle of one order, one screen, one URL.
 *
 * Rebuilt 2026-09-20 around a real complaint: every "Related record" here —
 * the indent's documents, the lorry receipt, the proof of delivery — used to
 * be a button that navigated away to that record's own page. Someone reading
 * one order lost their place doing it, and the console read as five separate
 * tools stitched together rather than one order management system. The three
 * tabs below are real navigation only in the sense that switching them
 * updates what this one page shows — the URL never changes, and every action
 * (upload a document, verify a proof of delivery, generate the LR) happens
 * right here, because `TripDocumentsContent`, `PodVerifyContent` and
 * `LorryReceiptContent` are the *exact* components the standalone
 * `/trips/[id]/documents`, `/pod/[id]/verify` and `/trips/[id]/lr` routes
 * render — extracted once, not copied, so there is exactly one upload
 * workflow and one verify workflow to keep working, not two.
 *
 * The advance and balance gates are the same real, permission-checked panels
 * used on the indent/trip pages and the payment queues too — releasing money
 * here does the same thing releasing it there does.
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

  if (error) return <ErrorState message={error} retry={load} />;
  if (!order) return <Loading what="Loading the order" />;

  return (
    <ModuleGuard module="orders">
      <PageHeader
        title={order.indentCode}
        sub={`${order.clientName} · ${order.lane}${order.tripCode ? ` · trip ${order.tripCode}` : ''}`}
        module="orders"
        right={<Tag tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Tag>}
      />
      <PageIntro
        what="Everything about one order on a single screen — its details, its documents and lorry receipt, and its delivery proof, all in place. Nothing here sends you to another page to see or do something."
        who="Every desk can open this; only Finance can actually release the advance or balance payment shown here."
      />

      {/* The wireframe's header strip: the three record IDs one order is known
          by, who it's for, and where it's going — the answer to "which order
          is this" before reading a single tab's content. */}
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
              <Link href="/invoices">{order.invoiceCode}</Link>
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
          {/* The forward-looking ladder the wireframe calls "Order Stage" —
              past, current and still-to-come steps together, not just the
              history of what already happened (that's the panel below).
              `order.status === 'FAILED'` never reaches step 2, so the ladder
              renders it as stuck rather than a step quietly skipped. */}
          <div style={{ marginBottom: 16 }}>
            <Panel title="🚚 Order stage">
              <Journey step={order.stepNo} stuck={STUCK_STATUSES.includes(order.status)} />
            </Panel>
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
                    ['Vehicle', order.vehicleNo ?? 'not placed yet'],
                    ['Driver', order.driverName ?? '—'],
                  ]}
                />
              </Panel>
            )}

            {/*
              What actually happened, in the order it happened.

              These are recorded `order_events`: one row per entry into a step,
              appended, never overwritten — so a step that failed twice before
              sailing through looks different from one that never stumbled.
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
          </Stack>
        ) : (
          <EmptyState
            title="No documents yet"
            hint="Documents and the lorry receipt open up once a transporter is awarded and a trip is generated for this order."
          />
        ))}

      {tab === 'proof' &&
        (order.tripId ? (
          <PodVerifyContent tripId={order.tripId} showOrderLink={false} showStatusTag={false} />
        ) : (
          <EmptyState
            title="Nothing to check yet"
            hint="Proof of delivery opens up once a transporter is awarded and a trip is generated for this order. Live vehicle position is on the Tracking page while it's on the road."
          />
        ))}

      {tab === 'payments' && <OrderPaymentsTab order={order} />}

      {tab === 'comments' && (
        <Panel title="Special instructions">
          {order.remarks ? (
            <p style={{ margin: 0, fontSize: 'var(--text-base)', lineHeight: 1.55 }}>{order.remarks}</p>
          ) : (
            <EmptyState
              title="Nothing noted for this order"
              hint="Whatever was written when the load request was raised — packing instructions, a gate-closing time, anything the transporter needs to know — shows up here."
            />
          )}
        </Panel>
      )}
    </ModuleGuard>
  );
}

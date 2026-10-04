'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { ApprovalRequiredError, errorMessage } from '@/apis';
import { AllocateVehicleDialog } from '@/components/allocate-vehicle-dialog';
import { awardQuote, getIndent } from '@/app/indents/apis';
import type { IndentDetail, Quote } from '@/app/indents/types';
import { useAtomValue } from 'jotai';
import {
  addTracking,
  assignLoadingSupervisor,
  deliverTrip,
  departTrip,
  getLoadingSupervisorOptions,
  getTrip,
  type LoadingSupervisorOption,
} from '@/app/trips/apis';
import type { TripDetail } from '@/app/trips/types';
import { fmtDateTime, inr } from '@/lib/format';
import { Banner, Dialog, Field, Panel, Tag, useCan, useToast } from '@/lib/ui';
import { sessionAtom } from '@/store/atoms';
import type { OrderDetail } from '../types';

/** Where the order page can send someone to finish a step in place. */
export type OrderTabTarget = 'documents' | 'tracking';

interface Check {
  label: string;
  done: boolean;
  /** Shown instead of a tick while not done — what to do, or who does it. */
  todo?: ReactNode;
  /** Informational: not done yet, but does not stop the next action. */
  optional?: boolean;
}

/**
 * "What happens next" for one order, with the button that does it.
 *
 * The complaint this answers: the order page was a place to *read* an order,
 * and every action that moved it — awarding a quote, allocating the vehicle,
 * starting the trip, marking it delivered — lived on the indent or trip page.
 * So people sat on the order page and the order "would not move". Now the
 * next action is here, on the page they are on, and anything it needs first is
 * listed by name with a tick or the thing still to do.
 *
 * Every button calls the same endpoint the indent and trip pages call; the
 * server still decides, and a refusal comes back as a toast in its own words.
 */
export function OrderNextStep({
  order,
  onChanged,
  openTab,
}: {
  order: OrderDetail;
  onChanged: () => void;
  openTab: (tab: OrderTabTarget) => void;
}) {
  const can = useCan();
  const toast = useToast();
  const session = useAtomValue(sessionAtom);
  const [indent, setIndent] = useState<IndentDetail | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  // The loading supervisor runs the loading and uploads the loading documents;
  // they see only the trips assigned to them, so the order offers the assignment.
  const [supervisorOpen, setSupervisorOpen] = useState(false);
  const [supervisorOptions, setSupervisorOptions] = useState<LoadingSupervisorOption[]>([]);
  const [supervisorId, setSupervisorId] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(() => new Date().toISOString().slice(0, 16));

  const load = () => {
    getIndent(order.indentId).then(setIndent).catch(() => setIndent(null));
    if (order.tripId) getTrip(order.tripId).then(setTrip).catch(() => setTrip(null));
    else setTrip(null);
  };
  // Reload whenever the order itself moved.
  useEffect(load, [order.indentId, order.tripId, order.status]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast(done);
      load();
      onChanged();
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        toast(`Sent to ${e.approval.approverRole} for approval — it goes through by itself once approved`);
        load();
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!indent) return null;

  const canRun = can('indent.manage');
  const opsOnly = <span className="muted">Operations does this</span>;

  // ---- The load has not got a transporter yet --------------------------------
  if (indent.stage === 'CANCELLED') {
    return (
      <Panel title="👉 Next step">
        <Banner tone="grey" title="This load was cancelled">
          {indent.cancelReason ?? 'No remark was recorded.'}
        </Banner>
      </Panel>
    );
  }

  if (indent.stage === 'OPEN') {
    const quotes = [...indent.quotes].filter((q) => q.status === 'SUBMITTED').sort((a, b) => a.amountPaise - b.amountPaise);
    return (
      <Panel
        title="👉 Next step · give the load to a transporter"
        right={
          <Link className="btn btn-secondary btn-sm" href={`/indents/${indent.id}`}>
            Enter a quote
          </Link>
        }
        pad={false}
      >
        {quotes.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5, margin: 0, padding: 15 }}>
            No quotes yet. Transporters quote from their portal; a price given by phone can be entered with
            “Enter a quote”. Quotes appear here cheapest first, ready to award.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {quotes.slice(0, 5).map((q: Quote) => (
              <div
                key={q.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 15px', borderTop: '1px solid var(--color-divider)', flexWrap: 'wrap' }}
              >
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600 }}>{q.vendorName}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {q.truckRegistration || 'truck not named'} · margin {inr(indent.sellRatePaise - q.amountPaise)}
                  </div>
                </div>
                <Tag tone={q.bandPosition === 'ABOVE_BAND' ? 'flag' : q.bandPosition === 'BELOW_BAND' ? 'blue' : 'mint'}>
                  {q.bandPosition === 'ABOVE_BAND' ? 'Above band' : q.bandPosition === 'BELOW_BAND' ? 'Below band' : 'In band'}
                </Tag>
                <strong style={{ minWidth: 90, textAlign: 'right' }}>{inr(q.amountPaise)}</strong>
                {q.vendorStatus !== 'ACTIVE' ? (
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Not cleared by Compliance
                  </span>
                ) : canRun ? (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => awardQuote(indent.id, q.id),
                        `Awarded to ${q.vendorName} at ${inr(q.amountPaise)} — allocate the vehicle next`,
                      )
                    }
                  >
                    {q.bandPosition === 'ABOVE_BAND' ? 'Request approval' : 'Award'}
                  </button>
                ) : (
                  opsOnly
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  // Indents awarded before the award itself generated the trip.
  if (!trip) {
    return (
      <Panel title="👉 Next step">
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          This load was awarded before trips were generated on award. Finish it on the load request.
        </p>
        <Link className="btn" href={`/indents/${indent.id}`}>
          Open the load request
        </Link>
      </Panel>
    );
  }

  // ---- Before the truck leaves -------------------------------------------------
  if (trip.stage === 'OPEN') {
    const gating = trip.documents.filter((d) => d.gatesAdvance);
    // An issued E-LR stands in for the loading slip.
    const lrIssued = !!trip.lr?.code;
    const docsIn = gating.filter(
      (d) => d.status === 'PENDING' || d.status === 'VERIFIED' || (d.kind === 'LOADING_SLIP' && lrIssued),
    ).length;
    const lrStarted = !!trip.lr && trip.lr.status !== 'RELEASED';
    // The loading slip stands in for the lorry receipt.
    const slipIn = trip.documents.some((d) => d.kind === 'LOADING_SLIP' && (d.status === 'PENDING' || d.status === 'VERIFIED'));
    const canMark = canRun || (!!trip.loadingSupervisorId && trip.loadingSupervisorId === session?.userId);
    // The order cycle, in the order Operations works it: vehicle → reached the
    // loading point → loaded → advance documents → (LR if needed) → on the road.
    const checks: Check[] = [
      {
        label: trip.vehicleNo ? `Vehicle allocated · ${trip.vehicleNo}` : 'Vehicle allocated',
        done: !!trip.vehicleNo,
        todo: canRun ? (
          <button className="btn btn-sm" onClick={() => setAllocateOpen(true)}>
            Allocate vehicle
          </button>
        ) : (
          opsOnly
        ),
      },
      {
        label: trip.loadingSupervisorName ? `Loading supervisor · ${trip.loadingSupervisorName}` : 'Loading supervisor assigned',
        done: !!trip.loadingSupervisorId,
        optional: true,
        todo: canRun ? (
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => {
              setSupervisorId('');
              setSupervisorOpen(true);
              getLoadingSupervisorOptions(trip.id)
                .then(setSupervisorOptions)
                .catch(() => setSupervisorOptions([]));
            }}
          >
            👷 Assign loading supervisor
          </button>
        ) : (
          opsOnly
        ),
      },
      {
        label: trip.reachedLoadingAt ? `Reached the loading point · ${fmtDateTime(trip.reachedLoadingAt)}` : 'Reached the loading point',
        done: !!trip.reachedLoadingAt || !!trip.loadingCompletedAt,
        todo: !canMark ? (
          opsOnly
        ) : (
          <button
            className="btn btn-sm"
            disabled={busy || !trip.vehicleNo}
            onClick={() => run(() => addTracking(trip.id, { kind: 'REACHED_LOADING' }), 'Marked · reached the loading point')}
          >
            📍 Reached the loading point
          </button>
        ),
      },
      {
        label: trip.loadingCompletedAt ? `Loaded · ${fmtDateTime(trip.loadingCompletedAt)}` : 'Loaded',
        done: !!trip.loadingCompletedAt,
        todo: !canMark ? (
          opsOnly
        ) : (
          <button
            className="btn btn-sm"
            disabled={busy || !trip.reachedLoadingAt}
            onClick={() => run(() => addTracking(trip.id, { kind: 'LOADED' }), 'Marked loaded · upload the advance documents next')}
          >
            📦 Loaded
          </button>
        ),
      },
      {
        label: `Advance documents uploaded · ${docsIn} of ${gating.length}`,
        done: docsIn === gating.length,
        todo: trip.loadingCompletedAt ? (
          <button className="btn btn-secondary btn-sm" onClick={() => openTab('documents')}>
            Upload documents
          </button>
        ) : (
          <span className="muted">Uploaded once the truck is loaded</span>
        ),
      },
      {
        label:
          trip.lr?.status === 'RELEASED'
            ? `E-LR issued · ${trip.lr.code}`
            : slipIn && !lrStarted
              ? 'Lorry receipt — not needed, the loading slip is in'
              : 'E-LR issued (if the client wants one)',
        done: trip.lr?.status === 'RELEASED' || (slipIn && !lrStarted),
        optional: !lrStarted,
        todo: (
          <button className="btn btn-secondary btn-sm" onClick={() => openTab('documents')}>
            {lrStarted ? 'Finish and issue the E-LR' : '＋ Generate E-LR'}
          </button>
        ),
      },
      {
        label: trip.advancePaidPaise > 0 ? `Advance paid · ${inr(trip.advancePaidPaise)}` : 'Advance paid',
        done: trip.advancePaidPaise > 0,
        optional: true,
        todo: (
          <span className="muted">
            Finance releases it once Compliance verifies the documents — then the truck moves to the road by itself
          </span>
        ),
      },
    ];
    const blocking = checks.filter((c) => !c.done && !c.optional);
    return (
      <Panel title="👉 Next step · get the truck on the road">
        <CheckList checks={checks} />
        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {canRun ? (
            <button
              className="btn"
              disabled={busy || blocking.length > 0}
              onClick={() => run(() => departTrip(trip.id), 'Trip started — the truck is on the road and tracking begins')}
            >
              🚚 Start trip — mark departed
            </button>
          ) : (
            opsOnly
          )}
          {blocking.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              Finish the {blocking.length === 1 ? 'item' : `${blocking.length} items`} above first.
            </span>
          )}
        </div>
        {indent && (
          <AllocateVehicleDialog
            open={allocateOpen}
            indent={indent}
            onClose={() => setAllocateOpen(false)}
            onAllocated={() => {
              load();
              onChanged();
              // Vehicle assigned: it goes for tracking — on the way to the loading point.
              openTab('tracking');
            }}
          />
        )}
        <Dialog
          open={supervisorOpen}
          title="Assign loading supervisor"
          body="They run the loading for this order and upload its loading and vehicle documents. The order shows on their own screen."
          confirmLabel="Assign"
          confirmDisabled={!supervisorId}
          busy={busy}
          onConfirm={async () => {
            await run(() => assignLoadingSupervisor(trip.id, supervisorId), 'Loading supervisor assigned');
            setSupervisorOpen(false);
          }}
          onClose={() => setSupervisorOpen(false)}
        >
          <Field label="Supervisor" required>
            <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
              <option value="">Choose a person…</option>
              {supervisorOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        </Dialog>
      </Panel>
    );
  }

  // ---- On the road ----------------------------------------------------------------
  if (trip.stage === 'IN_TRANSIT') {
    return (
      <Panel
        title="👉 Next step · deliver"
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {can('invoice.create') && !order.invoiceId && (
              <Link className="btn btn-secondary btn-sm" href={`/invoices/new?client=${order.clientId}&trip=${trip.id}`}>
                🧾 Raise the client invoice
              </Link>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => openTab('tracking')}>
              🧭 Open Tracking
            </button>
          </div>
        }
      >
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          The truck is on the road. Keep the Tracking tab updated, mark it at the unloading point, then mark it
          unloaded — that starts the delivery-proof clock.
          {trip.reachedDestinationAt ? ` Reached the unloading point ${fmtDateTime(trip.reachedDestinationAt)}.` : ''}
        </p>
        {canRun ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            {!trip.reachedDestinationAt && (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => run(() => addTracking(trip.id, { kind: 'REACHED' }), 'Marked · reached the unloading point')}
              >
                🏁 Reached the unloading point
              </button>
            )}
            <label className="field" style={{ margin: 0 }}>
              <span className="muted" style={{ fontSize: 11.5 }}>
                Unloaded at
              </span>
              <input type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} />
            </label>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(
                  () => deliverTrip(trip.id, new Date(deliveredAt).toISOString()),
                  'Marked unloaded — upload the proof of delivery next',
                )
              }
            >
              📦 Mark unloaded
            </button>
          </div>
        ) : (
          opsOnly
        )}
      </Panel>
    );
  }

  // ---- Delivered: proof, then money ------------------------------------------------
  const pod = trip.podStatus;
  const podDone = pod === 'APPROVED' || pod === 'WAIVED';
  const checks: Check[] = [
    {
      label: 'Proof of delivery in — E-POD or H-POD',
      done: pod !== 'PENDING' && pod !== 'ATTACHED' && pod !== 'FORFEITED',
      todo: (
        <button className="btn btn-sm" onClick={() => openTab('documents')}>
          {pod === 'ATTACHED' ? 'Receive the proof' : 'Upload E-POD or log H-POD'}
        </button>
      ),
    },
    {
      label: 'Delivery proof checked and approved',
      done: podDone,
      todo: (
        <button className="btn btn-secondary btn-sm" onClick={() => openTab('documents')}>
          {pod === 'VERIFIED' ? 'Approve the proof' : 'Check the proof'}
        </button>
      ),
    },
    {
      label: trip.balancePaidPaise > 0 ? `Balance paid · ${inr(trip.balancePaidPaise)}` : 'Balance paid to the transporter',
      done: trip.balancePaidPaise > 0,
      todo: <span className="muted">Finance releases it in the balance panel beside this one</span>,
    },
    {
      label: order.invoiceCode ? `Client invoiced · ${order.invoiceCode}` : 'Client invoiced',
      done: !!order.invoiceId,
      todo: can('invoice.create') ? (
        <Link className="btn btn-secondary btn-sm" href={`/invoices/new?client=${order.clientId}&trip=${trip.id}`}>
          Raise the invoice
        </Link>
      ) : (
        <span className="muted">Finance raises it</span>
      ),
    },
  ];
  return (
    <Panel title={pod === 'FORFEITED' ? '👉 Balance forfeited' : '👉 Next step · close it out'}>
      {pod === 'FORFEITED' && (
        <div style={{ marginBottom: 12 }}>
          <Banner tone="red" title="The delivery proof never arrived in time">
            The transporter’s balance is forfeited. The client can still be invoiced.
          </Banner>
        </div>
      )}
      <CheckList checks={checks} />
    </Panel>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  const firstOpen = checks.findIndex((c) => !c.done && !c.optional);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {checks.map((c, i) => (
        <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span aria-hidden style={{ width: 20, textAlign: 'center' }}>
            {c.done ? '✅' : c.optional ? '⏳' : i === firstOpen ? '👉' : '⬜'}
          </span>
          <span style={{ flex: 1, minWidth: 180, fontWeight: i === firstOpen ? 600 : undefined }}>{c.label}</span>
          {!c.done && c.todo}
        </div>
      ))}
    </div>
  );
}

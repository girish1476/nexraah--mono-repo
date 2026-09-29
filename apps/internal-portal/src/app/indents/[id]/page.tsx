'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, ApprovalRequiredError, errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import { ROLES } from '@/lib/permissions';
import {
  Banner,
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  FactList,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Split,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { listVendors } from '@/app/vendors/apis';
import type { VendorListRow } from '@/app/vendors/types';
import { awardQuote, cancelIndent, createTrip, getIndent, reassignTransporter, recordPlacement, recordQuote } from '../apis';
import { IndentDetail, Quote } from '../types';

/** Stage order for the progress stepper — position, not identity, is what "complete" means. */
const STAGE_ORDER = ['OPEN', 'VENDOR_ASSIGNED', 'VEHICLE_PLACED', 'TRIP_CREATED'];

/**
 * Indent detail — `/indents/[id]` (part 04 §3).
 *
 * Quotes cheapest first with their band position, the advance gate scoped to
 * this record, placement capture and trip creation. Awarding writes the buy
 * rate at the moment of the decision — it is never reconstructed from a rate
 * card afterwards (BR-06).
 */
export default function IndentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const toast = useToast();

  const [indent, setIndent] = useState<IndentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState<string | null>(null);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [placement, setPlacement] = useState({
    vehicleNo: '',
    driverName: '',
    driverLicence: '',
    reportedAt: new Date().toISOString().slice(0, 16),
    remarks: '',
  });
  const [busy, setBusy] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [vendors, setVendors] = useState<VendorListRow[]>([]);
  const [quoteForm, setQuoteForm] = useState({ vendorId: '', amountRupees: '', truckRegistration: '', remarks: '' });

  const load = () => {
    setError(null);
    getIndent(id).then(setIndent).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const onAward = async (quote: Quote) => {
    setBusy(true);
    try {
      const updated = await awardQuote(id, quote.id);
      setIndent(updated);
      toast(
        updated.tripCode
          ? `Awarded to ${quote.vendorName} at ${inr(quote.amountPaise)} · trip ${updated.tripCode} generated — allocate the vehicle next`
          : `Awarded to ${quote.vendorName} at ${inr(quote.amountPaise)} · buy rate written`,
      );
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        setAwaitingApproval(quote.id);
        toast(`Sent to ${e.approval.approverRole} · above band by ${inr(quote.amountPaise - (indent?.bidMaxPaise ?? 0))}`);
      } else if (e instanceof ApiError && e.code === 'VENDOR_NOT_ACTIVE') {
        toast(e.message);
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    setBusy(true);
    try {
      setIndent(await cancelIndent(id, reasonText.trim()));
      setCancelOpen(false);
      setReasonText('');
      toast('Indent cancelled — the remark is on its record');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onReassign = async () => {
    setBusy(true);
    try {
      setIndent(await reassignTransporter(id, reasonText.trim()));
      setReassignOpen(false);
      setReasonText('');
      toast('Transporter taken off — enter or accept another quote to place the load again');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openQuoteDialog = () => {
    setQuoteForm({ vendorId: '', amountRupees: '', truckRegistration: '', remarks: '' });
    setQuoteOpen(true);
    listVendors({ status: 'ACTIVE' })
      .then(setVendors)
      .catch((e) => toast(errorMessage(e)));
  };

  const onRecordQuote = async () => {
    const amountPaise = Math.round(Number(quoteForm.amountRupees) * 100);
    if (!quoteForm.vendorId || !Number.isFinite(amountPaise) || amountPaise < 1) return;
    setBusy(true);
    try {
      const updated = await recordQuote(id, {
        vendorId: quoteForm.vendorId,
        amountPaise,
        truckRegistration: quoteForm.truckRegistration.trim() || undefined,
        remarks: quoteForm.remarks.trim() || undefined,
      });
      setIndent(updated);
      setQuoteOpen(false);
      toast('Quote entered — it now ranks with the others below');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openPlacement = () => {
    const awarded = indent?.quotes.find((q) => q.id === indent.awardedQuoteId);
    setPlacement((p) => ({
      ...p,
      vehicleNo: indent?.vehicleNo ?? awarded?.truckRegistration ?? p.vehicleNo,
      driverName: indent?.driverName ?? p.driverName,
      driverLicence: indent?.driverLicence ?? p.driverLicence,
    }));
    setPlacementOpen(true);
  };

  const onPlacement = async () => {
    if (!indent) return;
    setBusy(true);
    const late = new Date(placement.reportedAt).getTime() > new Date(indent.pickupDate).getTime();
    try {
      const updated = await recordPlacement(id, { ...placement, transitDelay: late });
      setIndent(updated);
      setPlacementOpen(false);
      toast(late ? 'Placement recorded · flagged as a transit delay' : 'Placement recorded');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onCreateTrip = async () => {
    setBusy(true);
    try {
      const trip = await createTrip(id);
      toast(`${trip.code} created`);
      router.push(`/trips/${trip.id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!indent) return <Loading what="Loading the indent" />;

  // Each step's completion comes from the data it actually represents, not
  // from matching the indent's single `stage` against a lookup entry — two
  // steps ("Raised" and "Quotes in") both fall under stage OPEN, so a shared
  // stage key can never tell them apart.
  const stagePosition = STAGE_ORDER.indexOf(indent.stage);
  // No `distance_km` column exists in the backend, so this row is only
  // included when the value is actually present — same
  // build-then-filter shape as `home/page.tsx`'s `attention` list.
  const indentFacts: ([string, ReactNode] | null)[] = [
    ['Client', indent.clientName],
    ['Branch', indent.branchName],
    ['Material', indent.material],
    ['Truck type', indent.truckType],
    ['Weight', `${indent.weightTn} MT`],
    indent.distanceKm != null ? ['Distance', `${indent.distanceKm} km`] : null,
    ['Pickup', fmtDate(indent.pickupDate)],
    ['Transit days', indent.transitDays],
    ['Reporting', indent.reportingRule.replace(/_/g, ' ').toLowerCase()],
    [
      'Advance %',
      indent.advancePctOverridden
        ? `${indent.advancePct}% · set for this order`
        : indent.vendorId
          ? `${indent.advancePct}% · transporter’s standing policy`
          : 'Transporter’s standing policy · applies once awarded',
    ],
  ];
  const bandText =
    indent.bidMinPaise !== null && indent.bidMaxPaise !== null
      ? `${inr(indent.bidMinPaise)} – ${inr(indent.bidMaxPaise)}`
      : null;
  const progress = [
    { label: 'Raised', done: true },
    { label: 'Quotes in', done: indent.quotes.length > 0 },
    { label: 'Bid accepted', done: stagePosition >= STAGE_ORDER.indexOf('VENDOR_ASSIGNED') },
    { label: 'Trip generated', done: stagePosition >= STAGE_ORDER.indexOf('TRIP_CREATED') },
    { label: 'Vehicle allocated', done: !!indent.vehicleNo },
  ];
  // `POST /indents/:id/award` is `indent.manage` on the server. Including
  // `indent.view` here handed Finance and Leadership an Award button that
  // 403'd the moment they pressed it.
  const canAward = can('indent.manage');

  const columns: Column<Quote>[] = [
    {
      key: 'vendor',
      label: 'Transporter',
      render: (r) => (
        <div>
          <Link href={`/vendors/${r.vendorId}`}>{r.vendorName}</Link>
          {r.vendorStatus !== 'ACTIVE' && (
            <div>
              <Tag tone="red">{r.vendorStatus.replace(/_/g, ' ')}</Tag>
            </div>
          )}
        </div>
      ),
    },
    { key: 'truck', label: 'Truck', mono: true, render: (r) => r.truckRegistration },
    { key: 'amount', label: 'Quote', align: 'right', render: (r) => inr(r.amountPaise) },
    {
      key: 'band',
      label: 'Band',
      render: (r) => (
        <Tag tone={r.bandPosition === 'IN_BAND' ? 'mint' : 'flag'}>
          {r.bandPosition === 'IN_BAND' ? 'In band' : 'Out of band'}
        </Tag>
      ),
    },
    {
      key: 'margin',
      label: 'Margin',
      align: 'right',
      render: (r) => {
        const margin = indent.sellRatePaise - r.amountPaise;
        return (
          <span style={{ color: margin > 500000 ? 'var(--mint)' : margin > 200000 ? 'var(--flag)' : 'var(--red)' }}>
            {inr(margin)}
          </span>
        );
      },
    },
    { key: 'when', label: 'Submitted', render: (r) => fmtDateTime(r.submittedAt) },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => {
        if (indent.awardedQuoteId === r.id) return <Tag tone="mint">Awarded</Tag>;
        if (awaitingApproval === r.id) return <Tag tone="flag">Awaiting approval</Tag>;
        if (indent.stage !== 'OPEN') return <span className="muted">—</span>;
        if (r.vendorStatus !== 'ACTIVE')
          return (
            <span className="muted" style={{ fontSize: 11.5 }}>
              This transporter hasn’t been cleared by Compliance yet.
            </span>
          );
        if (!canAward)
          return (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Award is {ROLES.OPS.label}
            </span>
          );
        return (
          <button className="btn btn-sm" disabled={busy} onClick={() => onAward(r)}>
            {r.bandPosition === 'IN_BAND' ? 'Award' : 'Request approval'}
          </button>
        );
      },
    },
  ];

  return (
    <ModuleGuard module="indents">
      <PageHeader
        path={`/indents/${indent.code}`}
        title={indent.code}
        sub={`${indent.fromCity} → ${indent.toCity} · ${indent.truckType} · ${indent.weightTn} MT`}
        module="indents"
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {indent.stage === 'TRIP_CREATED' && can('indent.reassign') && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setReasonText('');
                  setReassignOpen(true);
                }}
              >
                Reassign transporter
              </button>
            )}
            {indent.stage !== 'CANCELLED' && can('indent.manage') && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setReasonText('');
                  setCancelOpen(true);
                }}
              >
                Cancel indent
              </button>
            )}
            <Link href={`/orders/${indent.id}`} className="btn btn-secondary">
              View order
            </Link>
          </div>
        }
      />
      <PageIntro
        what="Everything about one indent in one place — the transporter quotes with their band position, the buy rate locked in the moment a bid is accepted, the trip that accepting generates, and the vehicle allocated to it."
        who="Operations enters and accepts quotes and allocates the vehicle; everyone else with indent access can see the full record."
      />

      {indent.stage === 'CANCELLED' && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="red" title="This indent was cancelled">
            {indent.cancelReason ?? 'No remark was recorded.'}
            {indent.cancelledAt ? ` · ${fmtDateTime(indent.cancelledAt)}` : ''}
          </Banner>
        </div>
      )}

      <Split
        aside={
          <>
            <Panel title="Indent" pad={false}>
              <FactList facts={indentFacts.filter((f): f is [string, ReactNode] => f !== null)} />
            </Panel>

            <Panel
              title="Quotes"
              right={
                indent.stage === 'OPEN' && canAward ? (
                  <button className="btn btn-sm" onClick={openQuoteDialog}>
                    Enter a quote
                  </button>
                ) : undefined
              }
              pad={false}
            >
              <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px 0' }}>
                {bandText ? `Band ${bandText}` : 'No bid limits on this lane'}
              </div>
              <DataTable
                columns={columns}
                rows={[...indent.quotes].sort((a, b) => a.amountPaise - b.amountPaise)}
                rowKey={(r) => r.id}
                empty={
                  <EmptyState
                    title="No quotes yet"
                    hint="Transporters quote from their own portal, or Operations can enter a quote a transporter gave by phone with “Enter a quote”. Once quotes are in, they’re ranked cheapest first with their band position, ready to accept."
                  />
                }
              />
              <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.45 }}>
                A quote below the floor never reaches this desk — it is refused at entry in the transporter portal
                and never persisted. An above-band quote is kept and shown, because it is the honest market rate on
                that lane.
              </div>
            </Panel>
          </>
        }
      >
        <Panel title="Progress">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {progress.map((p) => (
              <Tag key={p.label} tone={p.done ? 'mint' : 'grey'}>
                {p.label}
              </Tag>
            ))}
          </div>
          {indent.failureCause && (
            <div style={{ marginTop: 12 }}>
              <Banner tone="red" title="Placement failed">
                Cause recorded as <strong>{indent.failureCause.replace(/_/g, ' ').toLowerCase()}</strong>. A lane
                that repeatedly draws only above-band quotes is a market gap, not a case for a wider band.
              </Banner>
            </div>
          )}
        </Panel>

        <Panel title="Pricing" pad={false}>
          <FactList
            facts={[
              ['Rate source', indent.rateSource],
              ['Client sell rate', inr(indent.sellRatePaise)],
              ['Sourcing rate', indent.sourcingRatePaise ? inr(indent.sourcingRatePaise) : '—'],
              ['Band', bandText ?? 'No limits set on the client’s rate card for this lane'],
              ['Buy rate', indent.buyRatePaise ? inr(indent.buyRatePaise) : 'not yet awarded'],
            ]}
          />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.45 }}>
            The rate you’re charging the client is internal — transporters never see it.
            {indent.bandLocked && ' The band is locked and cannot be widened.'}
          </div>
        </Panel>

        {indent.stage !== 'OPEN' && indent.buyRatePaise && (
          <AdvancePanel indentId={indent.id} onReleased={load} />
        )}

        <Panel title="Vehicle allocation">
          {indent.vehicleNo ? (
            <FactList
              facts={[
                ['Vehicle', indent.vehicleNo],
                ['Driver', indent.driverName ?? '—'],
                ['Licence', indent.driverLicence ?? '—'],
                ['Reported at', fmtDateTime(indent.reportedAt)],
              ]}
            />
          ) : (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              {indent.stage === 'TRIP_CREATED'
                ? `Trip ${indent.tripCode ?? ''} is generated. Allocate the vehicle: registration, driver, licence and the reported-at time. Where reporting is later than the client’s requirement, the trip is flagged as a transit delay in its own right.`
                : 'Accept a quote first. Accepting a bid generates the trip, and the vehicle is allocated on it.'}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {(indent.stage === 'VENDOR_ASSIGNED' || indent.stage === 'TRIP_CREATED') && can('indent.manage') && (
              <button className="btn" onClick={openPlacement}>
                {indent.vehicleNo ? 'Change vehicle' : 'Allocate vehicle'}
              </button>
            )}
            {indent.stage === 'VEHICLE_PLACED' && can('indent.manage') && (
              <button className="btn" onClick={onCreateTrip} disabled={busy}>
                Create trip
              </button>
            )}
            {indent.stage === 'TRIP_CREATED' && (
              <Link href={indent.tripId ? `/trips/${indent.tripId}` : '/trips'} className="btn btn-secondary">
                Open the trip
              </Link>
            )}
          </div>
        </Panel>
      </Split>

      <Dialog
        open={cancelOpen}
        title="Cancel this indent"
        body="The load is closed and any quote or trip made for it is set aside. A remark is required and stays on its record."
        confirmLabel="Cancel indent"
        confirmDisabled={reasonText.trim().length < 5}
        busy={busy}
        onConfirm={onCancel}
        onClose={() => setCancelOpen(false)}
      >
        <Field label="Remark" required hint="Why it is being cancelled — for example, the client withdrew the load.">
          <textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={reassignOpen}
        title="Reassign the transporter"
        body="The load comes off this transporter and reopens for quotes; its trip keeps its number and is set up again for whoever is given it. Only possible before the truck leaves and before any advance is paid."
        confirmLabel="Take it off this transporter"
        confirmDisabled={reasonText.trim().length < 5}
        busy={busy}
        onConfirm={onReassign}
        onClose={() => setReassignOpen(false)}
      >
        <Field label="Why" required hint="For example, the transporter could not provide the truck.">
          <textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={quoteOpen}
        title="Enter a quote"
        body="Use this when a transporter gave their price by phone or message instead of quoting from their own portal. It is ranked with the others and is accepted from this page."
        confirmLabel="Enter quote"
        confirmDisabled={!quoteForm.vendorId || !(Number(quoteForm.amountRupees) > 0)}
        busy={busy}
        onConfirm={onRecordQuote}
        onClose={() => setQuoteOpen(false)}
      >
        <FormGrid>
          <Field label="Transporter" required hint="Only cleared, active transporters can be quoted for.">
            <select value={quoteForm.vendorId} onChange={(e) => setQuoteForm({ ...quoteForm, vendorId: e.target.value })}>
              <option value="">Choose a transporter…</option>
              {vendors
                .filter((v) => !indent.quotes.some((q) => q.vendorId === v.id))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.legalName} · {v.baseCity}
                  </option>
                ))}
            </select>
          </Field>
          <Field
            label="Quote (₹)"
            required
            hint={bandText ? `Accepted range for this lane: ${bandText}. Above it goes to approval.` : undefined}
          >
            <input
              type="number"
              min={1}
              value={quoteForm.amountRupees}
              onChange={(e) => setQuoteForm({ ...quoteForm, amountRupees: e.target.value })}
            />
          </Field>
          <Field label="Truck registration" hint="Optional — the truck they expect to send.">
            <input
              value={quoteForm.truckRegistration}
              onChange={(e) => setQuoteForm({ ...quoteForm, truckRegistration: e.target.value })}
            />
          </Field>
          <Field label="Note">
            <input value={quoteForm.remarks} onChange={(e) => setQuoteForm({ ...quoteForm, remarks: e.target.value })} />
          </Field>
        </FormGrid>
      </Dialog>

      <Dialog
        open={placementOpen}
        title="Allocate vehicle"
        confirmLabel="Allocate vehicle"
        confirmDisabled={!placement.vehicleNo || !placement.driverName || !placement.driverLicence}
        busy={busy}
        onConfirm={onPlacement}
        onClose={() => setPlacementOpen(false)}
      >
        <FormGrid>
          <Field label="Vehicle number" required>
            <input
              value={placement.vehicleNo}
              onChange={(e) => setPlacement({ ...placement, vehicleNo: e.target.value })}
            />
          </Field>
          <Field label="Driver name" required>
            <input
              value={placement.driverName}
              onChange={(e) => setPlacement({ ...placement, driverName: e.target.value })}
            />
          </Field>
          <Field label="Driver licence" required>
            <input
              value={placement.driverLicence}
              onChange={(e) => setPlacement({ ...placement, driverLicence: e.target.value })}
            />
          </Field>
          <Field label="Reported at" required hint={`Client requirement: ${indent.reportingRule.replace(/_/g, ' ').toLowerCase()}`}>
            <input
              type="datetime-local"
              value={placement.reportedAt}
              onChange={(e) => setPlacement({ ...placement, reportedAt: e.target.value })}
            />
          </Field>
          <Field label="Remarks">
            <input value={placement.remarks} onChange={(e) => setPlacement({ ...placement, remarks: e.target.value })} />
          </Field>
        </FormGrid>
      </Dialog>
    </ModuleGuard>
  );
}

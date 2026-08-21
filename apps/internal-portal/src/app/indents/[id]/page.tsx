'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, ApprovalRequiredError, errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  Dialog,
  ErrorState,
  FactList,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Split,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { awardQuote, createTrip, getIndent, recordPlacement } from '../apis';
import { IndentDetail, Quote } from '../types';

const PROGRESS: { stage: string; label: string }[] = [
  { stage: 'OPEN', label: 'Raised' },
  { stage: 'OPEN', label: 'Quotes in' },
  { stage: 'VENDOR_ASSIGNED', label: 'Awarded' },
  { stage: 'VEHICLE_PLACED', label: 'Placed' },
  { stage: 'TRIP_CREATED', label: 'Trip created' },
];

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
      toast(`Awarded to ${quote.vendorName} at ${inr(quote.amountPaise)} · buy rate written`);
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

  const onPlacement = async () => {
    if (!indent) return;
    setBusy(true);
    const late = new Date(placement.reportedAt).getTime() > new Date(indent.pickupDate).getTime();
    try {
      const updated = await recordPlacement(id, { ...placement, transitDelay: late });
      setIndent(updated);
      setPlacementOpen(false);
      toast(late ? 'Placement recorded · flagged as a transit delay (BR-42)' : 'Placement recorded');
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

  const stageIndex = PROGRESS.findIndex((p) => p.stage === indent.stage);
  const canAward = can('indent.manage') || can('indent.view');

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
              Vendor not cleared (BR-01)
            </span>
          );
        if (!canAward)
          return (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Award is OPS or BRANCH_MGR
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
      />

      <Split
        aside={
          <>
            <Panel title="Indent" pad={false}>
              <FactList
                facts={[
                  ['Client', indent.clientName],
                  ['Branch', indent.branchName],
                  ['Material', indent.material],
                  ['Truck type', indent.truckType],
                  ['Weight', `${indent.weightTn} MT`],
                  ['Distance', `${indent.distanceKm} km`],
                  ['Pickup', fmtDate(indent.pickupDate)],
                  ['Transit days', indent.transitDays],
                  ['Reporting', indent.reportingRule.replace(/_/g, ' ').toLowerCase()],
                  ['Advance %', `${indent.advancePct}%`],
                ]}
              />
            </Panel>

            <Panel title="Pricing" pad={false}>
              <FactList
                facts={[
                  ['Rate source', indent.rateSource],
                  ['Client sell rate', inr(indent.sellRatePaise)],
                  ['Sourcing rate', indent.sourcingRatePaise ? inr(indent.sourcingRatePaise) : '—'],
                  ['Band', `${inr(indent.bidMinPaise)} – ${inr(indent.bidMaxPaise)}`],
                  ['Buy rate', indent.buyRatePaise ? inr(indent.buyRatePaise) : 'not yet awarded'],
                ]}
              />
              <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.45 }}>
                The sell rate is internal. It is never present on any transporter-facing response — the vendor
                database role holds no grant on the column at all (BR-55).
                {indent.bandLocked && ' The band is locked and cannot be widened (BR-39).'}
              </div>
            </Panel>
          </>
        }
      >
        <Panel title="Progress">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PROGRESS.map((p, i) => (
              <Tag key={p.label} tone={i <= stageIndex ? 'mint' : 'grey'}>
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

        <Panel
          title="Quotes"
          right={
            <span className="muted" style={{ fontSize: 11.5 }}>
              Band {inr(indent.bidMinPaise)} – {inr(indent.bidMaxPaise)}
            </span>
          }
          pad={false}
        >
          <DataTable
            columns={columns}
            rows={[...indent.quotes].sort((a, b) => a.amountPaise - b.amountPaise)}
            rowKey={(r) => r.id}
            empty="No quotes yet. Transporters quote in their own portal; this side reads them and awards."
          />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.45 }}>
            A quote below the floor never reaches this desk — it is refused at entry in the transporter portal
            and never persisted. An above-band quote is kept and shown, because it is the honest market rate on
            that lane (D-39).
          </div>
        </Panel>

        {indent.stage !== 'OPEN' && indent.buyRatePaise && (
          <AdvancePanel indentId={indent.id} onReleased={load} />
        )}

        <Panel title="Placement">
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
              Recording the placed vehicle captures registration, driver, licence and the reported-at time. Where
              reporting is later than the client’s requirement, the trip is flagged as a transit delay in its own
              right (BR-42).
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {indent.stage === 'VENDOR_ASSIGNED' && can('indent.manage') && (
              <button className="btn" onClick={() => setPlacementOpen(true)}>
                Record vehicle placed
              </button>
            )}
            {indent.stage === 'VEHICLE_PLACED' && can('indent.manage') && (
              <button className="btn" onClick={onCreateTrip} disabled={busy}>
                Create trip
              </button>
            )}
            {indent.stage === 'TRIP_CREATED' && (
              <Link href="/trips" className="btn btn-secondary">
                Open the trip
              </Link>
            )}
          </div>
        </Panel>
      </Split>

      <Dialog
        open={placementOpen}
        title="Record vehicle placed"
        confirmLabel="Record placement"
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

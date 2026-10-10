'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ApprovalRequiredError, errorMessage } from '@/apis';
import { fmtDate, inr, inrCompact } from '@/lib/format';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  FactList,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Split,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import {
  deletePendingRateLane,
  deleteRateLane,
  getClient,
  getPendingRateLanes,
  getRateCard,
  patchClient,
  setLaneBand,
} from '../apis';
import { DeleteRateDialog, useCanDeleteRates } from '../delete-rate-dialog';
import { EditLaneDialog, RejectedLanesPanel, useCanCorrectRates, type LaneEditTarget } from '../rate-corrections';
import { LiveLane, liveLanes } from '../lanes';
import {
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_REASON,
  CLIENT_STATUS_TONE,
  Client,
  PendingRateLane,
  RateCardLane,
  rateWithBasis,
} from '../types';

/**
 * Client file — `/clients/[id]`.
 *
 * The rate card is read-only here: it is the set of lanes won at RFQ, with rate,
 * validity, transit days and reporting rule per lane. It is never keyed on this
 * page — `rate_card_lanes.rfq_lane_id` is NOT NULL, so a line with no RFQ
 * provenance cannot exist (BR-37). A price agreed *after* the award moves
 * through Rate revision (`/clients/rate-changes`), which this page links to for
 * whoever holds `rate.revise`; superseded lanes are hidden here (`liveLanes`).
 */

/** The raw enum lower-cased reads like a bug ("same day"); name the rules. */
const REPORTING_LABEL: Record<RateCardLane['reportingRule'], string> = {
  SAME_DAY: 'Same day',
  NEXT_DAY: 'Next day',
  SCHEDULED: 'Scheduled slot',
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [lanes, setLanes] = useState<LiveLane[]>([]);
  const [error, setError] = useState<string | null>(null);
  const can = useCan();
  const toast = useToast();
  // `patchClient` has existed since the module shipped and had no caller, so a
  // company name could only be corrected by calling the API by hand. Finance
  // and Admin hold `client.manage`; nobody else sees this.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);

  const openEdit = () => {
    if (!client) return;
    setDraft({
      name: client.name,
      billingCity: client.billingCity,
      billingAddress: client.billingAddress ?? '',
      billingState: client.billingState ?? '',
      billingPincode: client.billingPincode ?? '',
      gstin: client.gstin,
      contact: client.contact,
      phone: client.phone,
      email: client.email,
      creditDays: client.creditDays,
      serviceLevel: client.serviceLevel,
      needsWeighmentSlip: !!client.needsWeighmentSlip,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await patchClient(id, draft);
      toast('Client details updated');
      setEditing(false);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Bid limits live on the lane. The first pair is set directly; changing an
  // existing pair is a Leadership decision, so the dialog asks for a reason.
  const [bandLane, setBandLane] = useState<RateCardLane | null>(null);
  const [bandMin, setBandMin] = useState('');
  const [bandMax, setBandMax] = useState('');
  const [bandReason, setBandReason] = useState('');
  const [bandBusy, setBandBusy] = useState(false);

  const openBand = (lane: RateCardLane) => {
    setBandLane(lane);
    setBandMin(lane.bidMinPaise ? String(lane.bidMinPaise / 100) : '');
    setBandMax(lane.bidMaxPaise ? String(lane.bidMaxPaise / 100) : '');
    setBandReason('');
  };

  const saveBand = async () => {
    if (!bandLane) return;
    const min = Math.round(Number(bandMin) * 100);
    const max = Math.round(Number(bandMax) * 100);
    if (!(min > 0) || !(max > 0)) {
      toast('Enter both a minimum and a maximum above zero');
      return;
    }
    if (max < min) {
      toast('The maximum cannot be below the minimum');
      return;
    }
    const isChange = bandLane.bidMinPaise !== null || bandLane.bidMaxPaise !== null;
    if (isChange && bandReason.trim().length < 20) {
      toast('Say why the limits are changing — at least 20 characters');
      return;
    }
    setBandBusy(true);
    try {
      await setLaneBand(id, bandLane.id, {
        bidMinPaise: min,
        bidMaxPaise: max,
        reason: isChange ? bandReason.trim() : undefined,
      });
      toast('Bid limits saved for this lane');
      setBandLane(null);
      load();
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        toast('Sent to Leadership — the limits change once they approve it');
        setBandLane(null);
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBandBusy(false);
    }
  };

  const [pending, setPending] = useState<PendingRateLane[]>([]);
  const canDelete = useCanDeleteRates();
  // A rate typed wrongly is corrected in place — agreed or still waiting.
  const canCorrect = useCanCorrectRates();
  const [editingLane, setEditingLane] = useState<LaneEditTarget | null>(null);
  const [rateTick, setRateTick] = useState(0);
  const [deleting, setDeleting] = useState<{ label: string; run: (reason: string) => Promise<unknown> } | null>(null);

  const load = () => {
    setError(null);
    Promise.all([getClient(id), getRateCard(id)])
      .then(([c, l]) => {
        setClient(c);
        setLanes(liveLanes(l));
      })
      .catch((e) => setError(errorMessage(e)));
    getPendingRateLanes(id)
      .then(setPending)
      .catch(() => setPending([]));
  };
  useEffect(load, [id]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!client) return <Loading what="Loading the client" />;

  const pendingColumns: Column<PendingRateLane>[] = [
    { key: 'truck', label: 'Truck type', render: (r) => r.truckType },
    { key: 'from', label: 'From', render: (r) => r.origin },
    { key: 'to', label: 'To', render: (r) => r.destination },
    { key: 'rate', label: 'Lane rate', align: 'right', render: (r) => rateWithBasis(inr(r.ratePaise), r.rateBasis) },
    { key: 'valid', label: 'Valid', render: (r) => `${fmtDate(r.validFrom)} → ${r.validTo ? fmtDate(r.validTo) : 'open'}` },
    { key: 'by', label: 'Added by', render: (r) => r.requesterName, sub: (r) => fmtDate(r.proposedAt) },
    {
      key: 'status',
      label: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag tone="flag">Awaiting approval</Tag>
          {canCorrect && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditingLane({ mode: 'pending', approvalId: r.approvalId, lane: r })}>
              ✏️ Edit
            </button>
          )}
          {canDelete && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setDeleting({
                  label: `${r.origin} → ${r.destination} · ${r.truckType} at ${rateWithBasis(inr(r.ratePaise), r.rateBasis)} (waiting for approval)`,
                  run: (reason) => deletePendingRateLane(id, r.approvalId, reason),
                })
              }
            >
              🗑 Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  const columns: Column<LiveLane>[] = [
    { key: 'truck', label: 'Truck type', render: ({ lane: r }) => r.truckType },
    { key: 'from', label: 'From location', render: ({ lane: r }) => r.origin },
    { key: 'to', label: 'To location', render: ({ lane: r }) => r.destination },
    { key: 'transit', label: 'Transit days', align: 'right', render: ({ lane: r }) => r.transitDays },
    {
      key: 'penalty',
      label: 'Late-delivery penalty',
      render: ({ lane: r }) =>
        r.transitPenaltyApplies ? `${inr(r.transitPenaltyPerDayPaise)} per day` : <span className="muted">Not applied</span>,
    },
    { key: 'rate', label: 'Lane rate', align: 'right', render: ({ lane: r }) => rateWithBasis(inr(r.ratePaise), r.rateBasis) },
    { key: 'basis', label: 'Rate basis', render: ({ lane: r }) => (r.rateBasis === 'PMT' ? 'PMT' : 'FTL') },
    {
      key: 'band',
      label: 'Bid limits',
      render: ({ lane: r }) => {
        const has = r.bidMinPaise !== null && r.bidMaxPaise !== null;
        return (
          <>
            {has ? (
              `${inr(r.bidMinPaise as number)} – ${inr(r.bidMaxPaise as number)}`
            ) : (
              <span className="muted">Not set</span>
            )}
            {can('client.manage') && (
              <div>
                <button className="btn btn-ghost btn-sm" onClick={() => openBand(r)}>
                  {has ? 'Change' : 'Set limits'}
                </button>
              </div>
            )}
          </>
        );
      },
    },
    {
      key: 'report',
      label: 'Vehicle reporting',
      render: ({ lane: r }) => REPORTING_LABEL[r.reportingRule] ?? r.reportingRule,
    },
    // Read-only text, not a dropdown: nobody can key this sheet. The value is
    // written by RFQ award and corrected on the quote lane it came from.
    {
      key: 'supplySource',
      label: 'Where vehicles come from',
      render: ({ lane: r }) => r.supplySourceLabel ?? 'Not recorded',
    },
    { key: 'supplyRemarks', label: 'Remarks', render: ({ lane: r }) => r.supplyRemarks ?? '—' },
    {
      key: 'valid',
      label: 'Price valid',
      render: ({ lane: r, replacedFrom }) => (
        <>
          {fmtDate(r.validFrom)} – {r.validTo ? fmtDate(r.validTo) : 'open-ended'}
          {replacedFrom && (
            <div className="muted" style={{ fontSize: 11.5 }}>
              New rate from {fmtDate(replacedFrom)}
            </div>
          )}
        </>
      ),
    },
    { key: 'rfq', label: 'Won in quote (RFQ)', mono: true, render: ({ lane: r }) => r.rfqLaneId },
    ...(canCorrect
      ? [
          {
            key: 'edit',
            label: '',
            align: 'right' as const,
            render: ({ lane: r }: LiveLane) => (
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingLane({ mode: 'agreed', laneId: r.id, lane: r })}>
                ✏️ Edit
              </button>
            ),
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            key: 'delete',
            label: '',
            align: 'right' as const,
            render: ({ lane: r }: LiveLane) => (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setDeleting({
                    label: `${r.origin} → ${r.destination} · ${r.truckType} at ${rateWithBasis(inr(r.ratePaise), r.rateBasis)}`,
                    run: (reason) => deleteRateLane(id, r.id, reason),
                  })
                }
              >
                🗑 Delete
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <ModuleGuard module="clients">
      <PageHeader
        path={`/clients/${client.code}`}
        title={client.name}
        sub={`${client.code} · billed at ${client.billingCity} · ${
          client.engagement === 'CONTRACT' ? 'contract client' : 'spot client'
        }`}
        module="clients"
        right={
          <Tag
            tone={CLIENT_STATUS_TONE[client.status]}
            reason={
              client.status === 'ACTIVE'
                ? `${client.creditDays} days to pay`
                : CLIENT_STATUS_REASON[client.status]
            }
          >
            {CLIENT_STATUS_LABEL[client.status]}
          </Tag>
        }
      />
      <PageIntro
        what="Everything we hold on one client — who to call, what they owe us, and the lane prices agreed with them."
        who="Finance changes client terms; ops and compliance read them here."
      />

      <Split
        aside={
          <Panel
            title="Client details"
            pad={false}
            right={
              can('client.manage') ? (
                <button className="btn btn-secondary btn-sm" onClick={openEdit}>
                  Edit
                </button>
              ) : undefined
            }
          >
            <FactList
              facts={[
                ['Code', client.code],
                [
                  'Billing address',
                  [client.billingAddress, client.billingCity, client.billingState, client.billingPincode]
                    .map((part) => String(part ?? '').trim())
                    .filter(Boolean)
                    .join(', ') || 'Not on file',
                ],
                ['GSTIN (tax number)', client.gstin || 'Not on file'],
                ['Contact person', client.contact],
                ['Phone', client.phone],
                ['Email', client.email],
                ['Pricing basis', client.engagement === 'CONTRACT' ? 'Contract' : 'Spot'],
                ['Agreement', client.agreementNo ?? 'No agreement on file'],
                [
                  'Agreement valid',
                  client.validTo
                    ? `${fmtDate(client.validFrom)} – ${fmtDate(client.validTo)}`
                    : 'No agreement — priced per load',
                ],
                ['Payment terms', `${client.creditDays} days from invoice`],
                ['Service promise', client.serviceLevel],
                ['Weighment slip', client.needsWeighmentSlip ? 'Needed with every load' : 'Not needed'],
                ['Unpaid with client', inrCompact(client.outstandingPaise)],
              ]}
            />
          </Panel>
        }
      >
        <Panel
          title="Rate card"
          right={
            can('rate.revise') ? (
              <div style={{ display: 'flex', gap: 8 }}>
                {client.engagement === 'CONTRACT' && (
                  <Link className="btn btn-sm" href={`/clients/rate-changes?client=${client.id}&add=1`}>
                    ➕ Add a lane
                  </Link>
                )}
                <Link className="btn btn-secondary btn-sm" href={`/clients/rate-changes?client=${client.id}`}>
                  ⚖️ Change a rate
                </Link>
              </div>
            ) : (
              <Tag tone="grey" reason="Prices come from the quote (RFQ) we won. A change after that goes through Finance, with a sign-off">
                Read-only
              </Tag>
            )
          }
          pad={false}
        >
          {client.engagement === 'SPOT' ? (
            <EmptyState
              title="No rate card — this client is priced per load"
              hint="Spot clients agree a price for each shipment. The client's written approval of that price is attached to the indent — their request for a truck — before it is raised."
            />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={lanes}
                rowKey={(r) => r.lane.id}
                empty={
                  <EmptyState
                    title="No lane prices agreed yet"
                    hint="Prices arrive here when a quote (RFQ) is won for this client, or when a lane is added by Finance and signed off. Until then the compliance desk keeps flagging this contract as unpriced, and nothing can be booked at an agreed rate."
                  />
                }
              />
              {lanes.length > 0 && (
                <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.55 }}>
                  Every price here traces back to the lane we quoted and won — that quote is the last column.
                  A price with no quote behind it cannot exist, which is why this table can only be read. A
                  price agreed since then is changed under Clients → Rate revision, and the old one is kept there.
                </div>
              )}
              {lanes.some(({ lane }) => !lane.supplySource) && (
                <div className="muted" style={{ fontSize: 11.5, padding: '0 14px 12px', lineHeight: 1.55 }}>
                  Where a lane has no supply recorded, it can only be set on the quote (RFQ) lane it came from,
                  before that quote is awarded — this table is written by the award and never keyed here.
                </div>
              )}
            </>
          )}
        </Panel>

        {/* Turned down: kept, so it can be corrected and sent again rather than typed afresh. */}
        <RejectedLanesPanel
          clientId={id}
          clientName={client.name}
          refreshKey={rateTick}
          onResent={() => {
            load();
            setRateTick((t) => t + 1);
          }}
        />

        {/* A lane added here is not on the rate card until it is approved, so
            it used to vanish — and was added again. It shows here meanwhile. */}
        {pending.length > 0 && (
          <Panel title="⏳ Lanes waiting for approval" pad={false}>
            <DataTable
              columns={pendingColumns}
              rows={pending}
              rowKey={(r) => r.approvalId}
            />
            <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.55 }}>
              <strong>Who approves:</strong> Compliance, Leadership or an administrator — anyone who can approve
              contracts — under Control → Approvals. Finance and BD add rates; they cannot approve their own. Each
              moves onto the rate card above once approved, so there is no need to add it again. A duplicate can be
              deleted by Leadership or an administrator.
            </div>
          </Panel>
        )}
      </Split>

      <DeleteRateDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={load} />
      <EditLaneDialog
        clientId={id}
        target={editingLane}
        onClose={() => setEditingLane(null)}
        onSaved={() => {
          load();
          setRateTick((t) => t + 1);
        }}
      />

      <Dialog
        open={bandLane !== null}
        title={
          bandLane && (bandLane.bidMinPaise !== null || bandLane.bidMaxPaise !== null)
            ? 'Change this lane’s bid limits'
            : 'Set this lane’s bid limits'
        }
        body={
          bandLane && (bandLane.bidMinPaise !== null || bandLane.bidMaxPaise !== null)
            ? 'These limits are already in force, so a change goes to Leadership and only takes effect once they approve it. Loads already raised keep the limits they were raised with.'
            : 'Below the minimum a transporter’s quote is refused. Above the maximum it is kept but flagged, and awarding it needs Leadership. Every load raised on this lane picks these up automatically.'
        }
        confirmLabel={bandBusy ? 'Saving…' : bandLane && bandLane.bidMinPaise !== null ? 'Send to Leadership' : 'Save limits'}
        onConfirm={saveBand}
        onClose={() => setBandLane(null)}
        busy={bandBusy}
      >
        <Field label="Bid minimum (₹)" required>
          <input name="bidMin" type="number" value={bandMin} onChange={(e) => setBandMin(e.target.value)} />
        </Field>
        <Field label="Bid maximum (₹)" required>
          <input name="bidMax" type="number" value={bandMax} onChange={(e) => setBandMax(e.target.value)} />
        </Field>
        {bandLane && (bandLane.bidMinPaise !== null || bandLane.bidMaxPaise !== null) && (
          <Field label="Why is this changing?" required hint="At least 20 characters. Leadership decides from this.">
            <textarea name="bidReason" value={bandReason} onChange={(e) => setBandReason(e.target.value)} rows={3} />
          </Field>
        )}
      </Dialog>

      <Dialog
        open={editing}
        title="Edit client details"
        body="Corrects what we hold on this client. The rate card is not editable here — a price agreed after the quote is changed under Rate revision."
        confirmLabel={saving ? 'Saving…' : 'Save changes'}
        onConfirm={saveEdit}
        onClose={() => setEditing(false)}
        busy={saving}
      >
        <Field label="Company name" required>
          <input
            value={draft.name ?? ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Billed at (city)">
          <input
            value={draft.billingCity ?? ''}
            onChange={(e) => setDraft({ ...draft, billingCity: e.target.value })}
          />
        </Field>
        <Field label="Billing address" hint="Door number, street and area. Printed under their name on every invoice.">
          <input
            value={draft.billingAddress ?? ''}
            onChange={(e) => setDraft({ ...draft, billingAddress: e.target.value })}
          />
        </Field>
        <Field label="State">
          <input
            value={draft.billingState ?? ''}
            onChange={(e) => setDraft({ ...draft, billingState: e.target.value })}
          />
        </Field>
        <Field
          label="PIN code"
          error={
            draft.billingPincode && !/^[1-9]\d{5}$/.test(draft.billingPincode) ? 'A PIN code is 6 digits' : undefined
          }
        >
          <input
            inputMode="numeric"
            maxLength={6}
            value={draft.billingPincode ?? ''}
            onChange={(e) => setDraft({ ...draft, billingPincode: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="GSTIN (tax number)">
          <input
            value={draft.gstin ?? ''}
            onChange={(e) => setDraft({ ...draft, gstin: e.target.value })}
          />
        </Field>
        <Field label="Contact person">
          <input
            value={draft.contact ?? ''}
            onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input
            value={draft.phone ?? ''}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            value={draft.email ?? ''}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
        </Field>
        <Field label="Payment terms (days from invoice)">
          <input
            type="number"
            value={draft.creditDays ?? 0}
            onChange={(e) => setDraft({ ...draft, creditDays: Number(e.target.value) })}
          />
        </Field>
        <Field label="Service promise">
          <input
            value={draft.serviceLevel ?? ''}
            onChange={(e) => setDraft({ ...draft, serviceLevel: e.target.value })}
          />
        </Field>
        <Field label="Weighment slip" hint="Not every client wants one. When not needed, orders do not wait for it.">
          <select
            value={draft.needsWeighmentSlip ? 'yes' : 'no'}
            onChange={(e) => setDraft({ ...draft, needsWeighmentSlip: e.target.value === 'yes' })}
          >
            <option value="no">Not needed</option>
            <option value="yes">Needed with every load</option>
          </select>
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

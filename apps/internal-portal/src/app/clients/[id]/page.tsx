'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
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
import { getClient, getRateCard, patchClient } from '../apis';
import {
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_REASON,
  CLIENT_STATUS_TONE,
  Client,
  RateCardLane,
} from '../types';

/**
 * Client file — `/clients/[id]`.
 *
 * The rate card is read-only: it is the set of lanes won at RFQ, with rate,
 * validity, transit days and reporting rule per lane. It is never keyed here —
 * `rate_card_lanes.rfq_lane_id` is NOT NULL, so a line with no RFQ provenance
 * cannot exist (BR-37).
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
  const [lanes, setLanes] = useState<RateCardLane[]>([]);
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
      gstin: client.gstin,
      contact: client.contact,
      phone: client.phone,
      email: client.email,
      creditDays: client.creditDays,
      serviceLevel: client.serviceLevel,
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

  const load = () => {
    setError(null);
    Promise.all([getClient(id), getRateCard(id)])
      .then(([c, l]) => {
        setClient(c);
        setLanes(l);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!client) return <Loading what="Loading the client" />;

  const columns: Column<RateCardLane>[] = [
    { key: 'lane', label: 'Lane', render: (r) => `${r.origin} → ${r.destination}` },
    { key: 'truck', label: 'Truck type', render: (r) => r.truckType },
    { key: 'rate', label: 'Agreed rate', align: 'right', render: (r) => inr(r.ratePaise) },
    { key: 'transit', label: 'Transit days', align: 'right', render: (r) => r.transitDays },
    {
      key: 'report',
      label: 'Vehicle reporting',
      render: (r) => REPORTING_LABEL[r.reportingRule] ?? r.reportingRule,
    },
    // Read-only text, not a dropdown: nobody can key this sheet. The value is
    // written by RFQ award and corrected on the quote lane it came from.
    {
      key: 'supplySource',
      label: 'Where vehicles come from',
      render: (r) => r.supplySourceLabel ?? 'Not recorded',
    },
    { key: 'supplyRemarks', label: 'Remarks', render: (r) => r.supplyRemarks ?? '—' },
    { key: 'valid', label: 'Price valid', render: (r) => `${fmtDate(r.validFrom)} – ${fmtDate(r.validTo)}` },
    { key: 'rfq', label: 'Won in quote (RFQ)', mono: true, render: (r) => r.rfqLaneId },
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
                ['GSTIN (tax number)', client.gstin ?? 'Not on file'],
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
                ['Unpaid with client', inrCompact(client.outstandingPaise)],
              ]}
            />
          </Panel>
        }
      >
        <Panel
          title="Rate card"
          right={
            <Tag tone="grey" reason="Prices come from the quote (RFQ) we won — they cannot be edited here">
              Read-only
            </Tag>
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
                rowKey={(r) => r.id}
                empty={
                  <EmptyState
                    title="No lane prices agreed yet"
                    hint="Prices arrive here when a quote (RFQ) is won for this client. Until then the compliance desk keeps flagging this contract as unpriced, and nothing can be booked at an agreed rate."
                  />
                }
              />
              {lanes.length > 0 && (
                <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.55 }}>
                  Every price here traces back to the lane we quoted and won — that quote is the last column.
                  A price with no quote behind it cannot exist, which is why this table can only be read.
                </div>
              )}
              {lanes.some((l) => !l.supplySource) && (
                <div className="muted" style={{ fontSize: 11.5, padding: '0 14px 12px', lineHeight: 1.55 }}>
                  Where a lane has no supply recorded, it can only be set on the quote (RFQ) lane it came from,
                  before that quote is awarded — this table is written by the award and never keyed here.
                </div>
              )}
            </>
          )}
        </Panel>
      </Split>

      <Dialog
        open={editing}
        title="Edit client details"
        body="Corrects what we hold on this client. The rate card is not editable here — those prices come from the quote we won."
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
      </Dialog>
    </ModuleGuard>
  );
}

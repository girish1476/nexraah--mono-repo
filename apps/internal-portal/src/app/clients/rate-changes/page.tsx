'use client';

import { useEffect, useState } from 'react';
import { ApprovalRequiredError, errorMessage } from '@/apis';
import { inr, fmtDate } from '@/lib/format';
import {
  ActionCard,
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
  SectionHead,
  Stack,
  StatStrip,
  Tag,
  useCan,
  useToast,
  FormGrid,
} from '@/lib/ui';
import {
  deletePendingRateLane,
  deleteRateLane,
  deleteRateRevision,
  getPendingRateLanes,
  getRateCard,
  listClients,
} from '../apis';
import { AddLaneDialog } from '../add-lane-dialog';
import { DeleteRateDialog, useCanDeleteRates } from '../delete-rate-dialog';
import { useCanCorrectRates } from '../rate-corrections';
import { LiveLane, liveLanes } from '../lanes';
import { Client, PendingRateLane, RateCardLane, rateWithBasis } from '../types';
import { editRateRevision, listRateRevisions, proposeRateRevision } from './apis';
import {
  RateRevision,
  REVISION_STATUS_EMOJI,
  REVISION_STATUS_LABEL,
  REVISION_STATUS_TONE,
} from './types';

/** The floor the server enforces, repeated here so the form says so before you submit. */
const MIN_REASON = 20;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `/clients/rate-changes` — changing a rate we have already agreed.
 *
 * Until now the rate card could only be written once, by winning an RFQ. If a
 * client agreed a new number mid-contract there was nowhere to put it, so the
 * choice was to re-run a whole quotation cycle or to keep billing the old rate
 * and argue about it later.
 *
 * Two things this screen is careful about, both of which are the reason it
 * exists rather than an editable cell on the rate card:
 *
 *  - **The old rate is not erased.** Changing a rate closes the current one and
 *    starts a new one from a date. A load that moved last month is still
 *    priced at what was agreed last month, and the history below says who
 *    changed it and why.
 *  - **One desk cannot do it alone.** Proposing sends it for sign-off. The
 *    people who can approve it are not the people who can propose it.
 */
export default function RateChangesPage() {
  const can = useCan();
  const toast = useToast();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const [lanes, setLanes] = useState<LiveLane[] | null>(null);
  const [history, setHistory] = useState<RateRevision[] | null>(null);

  const [editing, setEditing] = useState<RateCardLane | null>(null);
  const [newRate, setNewRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Lanes added and still waiting for sign-off — shown here too, so a lane
  // sent a moment ago does not seem to have vanished.
  const [pendingLanes, setPendingLanes] = useState<PendingRateLane[]>([]);
  const canDelete = useCanDeleteRates();
  const [deleting, setDeleting] = useState<{ label: string; run: (reason: string) => Promise<unknown> } | null>(null);
  // A rate change still waiting, being corrected.
  const canCorrect = useCanCorrectRates();
  const [fixing, setFixing] = useState<RateRevision | null>(null);
  const [fixRate, setFixRate] = useState('');
  const [fixFrom, setFixFrom] = useState('');

  const loadClients = () => {
    setError(null);
    listClients()
      .then((rows) => {
        setClients(rows);
        // The client file links here with `?client=<id>`, so the screen opens
        // on the client you came from. Read from `window.location` on mount —
        // the same reason `/pod/pending` does — rather than `useSearchParams()`.
        const asked = new URLSearchParams(window.location.search).get('client');
        const first = rows.find((c) => c.id === asked)?.id ?? rows[0]?.id ?? '';
        setClientId((current) => current || first);
        // The client file's "Add a lane" arrives as `?add=1`.
        if (new URLSearchParams(window.location.search).get('add') === '1') setAdding(true);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(loadClients, []);

  const loadClient = (id: string) => {
    if (!id) return;
    setLanes(null);
    setHistory(null);
    getRateCard(id).then((rows) => setLanes(liveLanes(rows))).catch((e) => toast(errorMessage(e)));
    listRateRevisions(id).then(setHistory).catch(() => setHistory([]));
    getPendingRateLanes(id).then(setPendingLanes).catch(() => setPendingLanes([]));
  };
  useEffect(() => loadClient(clientId), [clientId]);

  const startEdit = (lane: RateCardLane) => {
    setEditing(lane);
    // Pre-filled with the rate in force so the number on screen is the one
    // being changed, not an empty box you have to look up first.
    setNewRate(String(Math.round(lane.ratePaise / 100)));
    setEffectiveFrom(today());
    setReason('');
    setMailSubject('');
  };

  const submit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      // `propose` never resolves on success — it always answers `202
      // approvalRequired`, which `request()` turns into a thrown
      // `ApprovalRequiredError` (see `clients/rate-changes/apis.ts`). The
      // "sent for sign-off" outcome is that error, not a return value.
      await proposeRateRevision(clientId, {
        laneId: editing.id,
        newRatePaise: Math.round(Number(newRate) * 100),
        effectiveFrom,
        reason: reason.trim(),
        approvalMailSubject: mailSubject.trim(),
      });
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        toast('Sent for sign-off. The rate changes once it is approved.');
        setEditing(null);
        loadClient(clientId);
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={loadClients} />;
  if (!clients) return <Loading what="Loading clients" />;

  const selected = clients.find((c) => c.id === clientId);
  const canAddLane = can('rate.revise') && selected?.engagement === 'CONTRACT';

  const pending = (history ?? []).filter((r) => r.status === 'PENDING');
  const lanesPendingChange = new Set(
    pending.map((r) => `${r.lane ?? ''}·${r.truckType ?? ''}`),
  );

  const rupees = Number(newRate);
  const problem = (() => {
    if (!editing) return null;
    if (!Number.isFinite(rupees) || rupees <= 0) return 'Put in the new rate.';
    if (Math.round(rupees * 100) === editing.ratePaise) return 'That is the rate already agreed — nothing would change.';
    if (effectiveFrom < today()) {
      return 'A rate cannot start in the past — it would re-price loads already booked.';
    }
    if (reason.trim().length < MIN_REASON) {
      return `Say why it is changing (at least ${MIN_REASON} characters).`;
    }
    if (mailSubject.trim().length < 5) return 'Put in the subject of the BD and Leadership approval mail.';
    return null;
  })();

  const laneColumns: Column<LiveLane>[] = [
    { key: 'truck', label: 'Truck type', primary: true, render: ({ lane: l }) => l.truckType },
    { key: 'from', label: 'From location', render: ({ lane: l }) => l.origin },
    { key: 'to', label: 'To location', render: ({ lane: l }) => l.destination },
    { key: 'transit', label: 'Transit days', render: ({ lane: l }) => l.transitDays },
    { key: 'rate', label: 'Lane rate', render: ({ lane: l }) => rateWithBasis(inr(l.ratePaise), l.rateBasis) },
    {
      key: 'period',
      label: 'In force',
      render: ({ lane: l }) =>
        `${fmtDate(l.validFrom)} — ${l.validTo ? fmtDate(l.validTo) : 'open-ended'}`,
    },
    ...(canDelete
      ? [
          {
            key: 'delete',
            label: '',
            render: ({ lane: l }: LiveLane) => (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setDeleting({
                    label: `${l.origin} → ${l.destination} · ${l.truckType} at ${rateWithBasis(inr(l.ratePaise), l.rateBasis)}`,
                    run: (reason) => deleteRateLane(clientId, l.id, reason),
                  })
                }
              >
                🗑 Delete
              </button>
            ),
          },
        ]
      : []),
    {
      key: 'go',
      label: '',
      render: ({ lane: l, replacedFrom }) =>
        lanesPendingChange.has(`${l.origin} → ${l.destination}·${l.truckType}`) ? (
          <Tag tone="flag" emoji="⏳">
            Change waiting for sign-off
          </Tag>
        ) : replacedFrom ? (
          <Tag tone="grey" emoji="📅">
            New rate starts {fmtDate(replacedFrom)}
          </Tag>
        ) : (
          <button
            className="btn btn-secondary btn-sm"
            disabled={!can('rate.revise')}
            onClick={() => startEdit(l)}
          >
            Change this rate
          </button>
        ),
    },
  ];

  const historyColumns: Column<RateRevision>[] = [
    {
      key: 'lane',
      label: 'Route',
      primary: true,
      render: (r) => r.lane ?? '—',
      sub: (r) => r.truckType ?? '',
    },
    {
      key: 'change',
      label: 'Change',
      render: (r) => (
        <span>
          {inr(r.oldRatePaise)} → <strong>{inr(r.newRatePaise)}</strong>
        </span>
      ),
      sub: (r) => `from ${fmtDate(r.effectiveFrom)}`,
    },
    { key: 'why', label: 'Why', render: (r) => r.reason },
    {
      key: 'status',
      label: 'Where it stands',
      render: (r) => (
        <Tag tone={REVISION_STATUS_TONE[r.status]} emoji={REVISION_STATUS_EMOJI[r.status]}>
          {REVISION_STATUS_LABEL[r.status]}
        </Tag>
      ),
      sub: (r) => (r.requestedByName ? `asked for by ${r.requestedByName}` : ''),
    },
    { key: 'when', label: 'Raised', render: (r) => fmtDate(r.createdAt) },
    ...(canCorrect
      ? [
          {
            key: 'edit',
            label: '',
            render: (r: RateRevision) =>
              r.status === 'PENDING' ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFixing(r);
                    setFixRate(String(r.newRatePaise / 100));
                    setFixFrom(String(r.effectiveFrom).slice(0, 10));
                  }}
                >
                  ✏️ Edit
                </button>
              ) : null,
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            key: 'delete',
            label: '',
            render: (r: RateRevision) =>
              r.status === 'PENDING' ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setDeleting({
                      label: `Rate change ${r.lane ?? ''} · ${inr(r.oldRatePaise)} → ${inr(r.newRatePaise)} (waiting for sign-off)`,
                      run: (reason) => deleteRateRevision(clientId, r.id, reason),
                    })
                  }
                >
                  🗑 Delete
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  const pendingLaneColumns: Column<PendingRateLane>[] = [
    { key: 'truck', label: 'Truck type', primary: true, render: (r) => r.truckType },
    { key: 'from', label: 'From location', render: (r) => r.origin },
    { key: 'to', label: 'To location', render: (r) => r.destination },
    { key: 'rate', label: 'Lane rate', render: (r) => rateWithBasis(inr(r.ratePaise), r.rateBasis) },
    { key: 'by', label: 'Added by', render: (r) => r.requesterName, sub: (r) => fmtDate(r.proposedAt) },
    {
      key: 'state',
      label: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag tone="flag" emoji="⏳">
            Waiting for sign-off
          </Tag>
          {canDelete && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setDeleting({
                  label: `${r.origin} → ${r.destination} · ${r.truckType} at ${rateWithBasis(inr(r.ratePaise), r.rateBasis)} (waiting for approval)`,
                  run: (reason) => deletePendingRateLane(clientId, r.approvalId, reason),
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

  return (
    <ModuleGuard module="clients">
      <PageHeader
        title="Rate revision"
        sub="Move the price on a lane we have already agreed, with a reason and a sign-off"
        module="clients"
      />
      <PageIntro
        what="Pick a client. Add a lane to their rate card, or pick a lane whose rate is changing and say what it is changing to and why."
        who="Finance or BD asks for the change. Compliance, Leadership or an administrator approves it under Approvals before it takes effect. Leadership or an administrator can delete a duplicate."
      >
        The old rate is never wiped. It closes on the day before the new one starts, so a load that
        moved last month is still priced at what was agreed last month — and a billing query can be
        answered with what was true at the time.
      </PageIntro>

      <Panel>
        <Field label="Client" hint="Only clients with a rate card have lanes to change.">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.billingCity}
              </option>
            ))}
          </select>
        </Field>
      </Panel>

      <StatStrip
        stats={[
          {
            k: 'Lanes on this rate card',
            v: (lanes ?? []).filter(({ lane }) => lane.validFrom <= today()).length,
            emoji: '🛣️',
            id: 'rate-lanes',
            note: 'Routes we have an agreed price for',
          },
          {
            k: 'Changes waiting for sign-off',
            v: pending.length,
            emoji: '⏳',
            id: 'rate-pending',
            tone: pending.length > 0 ? 'flag' : undefined,
            note: 'Asked for, not yet agreed — the old rate still applies',
          },
          {
            k: 'Changes made',
            v: (history ?? []).filter((r) => r.status === 'APPLIED').length,
            emoji: '✅',
            id: 'rate-applied',
            note: 'Approved and now in force',
          },
        ]}
      />

      {pending.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <ActionCard
            emoji="⏳"
            tone="flag"
            count={pending.length}
            title={`rate change${pending.length === 1 ? '' : 's'} waiting for sign-off`}
            why="Until these are approved the old rate still applies, and loads raised now are still priced at it."
          />
        </div>
      )}

      <SectionHead
        emoji="🛣️"
        title="This client’s agreed rates"
        note="What we charge them today, per route and truck type"
        right={
          canAddLane ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
              ➕ Add a lane
            </button>
          ) : undefined
        }
      />

      <Panel pad={false}>
        {!lanes ? (
          <Loading what="Loading the rate card" />
        ) : (
          <DataTable
            columns={laneColumns}
            rows={lanes}
            rowKey={(l) => l.lane.id}
            empty={
              <EmptyState
                emoji="📄"
                title="This client has no agreed rates yet"
                hint={
                  selected?.engagement === 'SPOT'
                    ? 'This client is priced load by load, so they have no rate card. Change them to a contract client first.'
                    : 'A rate card is written when a rate request is won, or you can add a lane here — one route and truck type at a time.'
                }
                action={
                  canAddLane ? (
                    <button className="btn btn-sm" onClick={() => setAdding(true)}>
                      ➕ Add the first lane
                    </button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Panel>

      {pendingLanes.length > 0 && (
        <>
          <SectionHead
            emoji="⏳"
            title="Lanes waiting for approval"
            note="Added, not yet on the rate card. Compliance, Leadership or an administrator approves them under Approvals."
          />
          <Panel pad={false}>
            <DataTable columns={pendingLaneColumns} rows={pendingLanes} rowKey={(r) => r.approvalId} />
          </Panel>
        </>
      )}

      <SectionHead
        emoji="🕘"
        title="What has changed before"
        note="Every rate change asked for on this client, newest first"
      />

      <Panel pad={false}>
        {!history ? (
          <Loading what="Loading the history" />
        ) : (
          <DataTable
            columns={historyColumns}
            rows={history}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                emoji="🕘"
                title="No rate has been changed for this client"
                hint="Every change made here is kept, with the reason and who asked for it, so a billing query can be answered later."
              />
            }
          />
        )}
      </Panel>

      {selected && (
        <AddLaneDialog
          clientId={selected.id}
          clientName={selected.name}
          open={adding}
          onClose={() => setAdding(false)}
          onSent={() => loadClient(selected.id)}
        />
      )}

      <DeleteRateDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={() => loadClient(clientId)} />

      {/* A rate change still waiting for sign-off, corrected where it waits. */}
      <Dialog
        open={!!fixing}
        title="Edit the rate change"
        body="This change is still waiting for sign-off. Correct it here and it stays in the approver’s inbox with the new figures."
        facts={fixing ? [['Lane', fixing.lane ?? '—'], ['Rate now', inr(fixing.oldRatePaise)], ['Proposed', inr(fixing.newRatePaise)]] : undefined}
        confirmLabel="Save the change"
        confirmDisabled={
          !fixing ||
          !(Number(fixRate) > 0) ||
          !fixFrom ||
          (Math.round(Number(fixRate) * 100) === fixing.newRatePaise && fixFrom === String(fixing.effectiveFrom).slice(0, 10))
        }
        busy={busy}
        onConfirm={async () => {
          if (!fixing) return;
          setBusy(true);
          try {
            await editRateRevision(clientId, fixing.id, { newRatePaise: Math.round(Number(fixRate) * 100), effectiveFrom: fixFrom });
            toast('Rate change corrected — it is still waiting for sign-off');
            setFixing(null);
            loadClient(clientId);
          } catch (e) {
            toast(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
        onClose={() => setFixing(null)}
      >
        <FormGrid>
          <Field label="New rate (₹)" required>
            <input type="number" min="0" value={fixRate} onChange={(e) => setFixRate(e.target.value)} autoFocus />
          </Field>
          <Field label="From" required>
            <input type="date" value={fixFrom} onChange={(e) => setFixFrom(e.target.value)} />
          </Field>
        </FormGrid>
      </Dialog>

      {/* ---- propose one change ------------------------------------------ */}
      <Dialog
        open={Boolean(editing)}
        title={editing ? `${editing.origin} → ${editing.destination} · ${editing.truckType}` : ''}
        confirmLabel="Send for sign-off"
        confirmDisabled={Boolean(problem) || !can('rate.revise')}
        busy={busy}
        onConfirm={submit}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <Stack gap={14}>
            <div className="hint">
              Agreed today: <strong>{inr(editing.ratePaise)}</strong>, in force since{' '}
              {fmtDate(editing.validFrom)}.
            </div>

            <Field label="New rate (₹)" required>
              <input
                type="number"
                min={1}
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                autoFocus
              />
            </Field>

            <Field
              label="Starts from"
              required
              hint="The old rate runs until the day before this. Anything moving earlier keeps the old price."
            >
              <input
                type="date"
                min={today()}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>

            <Field
              label="Why it is changing"
              required
              hint="This is what a billing dispute gets argued from later — write it for somebody who was not in the conversation."
              error={problem ?? undefined}
            >
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Diesel surcharge agreed with their logistics head on 25 August"
              />
            </Field>

            <Field
              label="Approval mail subject"
              required
              hint="BD and Leadership approve a rate by mail; Compliance signs it off against that mail."
            >
              <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} placeholder="e.g. RE: Berger Paints rate revision" />
            </Field>

            <div className="hint">
              ⚖️ Sending this does not change the rate. It goes to somebody who can approve a
              contract, and takes effect only when they agree.
            </div>
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}

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
} from '@/lib/ui';
import { getRateCard, listClients } from '../apis';
import { Client, RateCardLane } from '../types';
import { listRateRevisions, proposeRateRevision } from './apis';
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
  const [lanes, setLanes] = useState<RateCardLane[] | null>(null);
  const [history, setHistory] = useState<RateRevision[] | null>(null);

  const [editing, setEditing] = useState<RateCardLane | null>(null);
  const [newRate, setNewRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadClients = () => {
    setError(null);
    listClients()
      .then((rows) => {
        setClients(rows);
        if (rows.length > 0) setClientId((current) => current || rows[0].id);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(loadClients, []);

  const loadClient = (id: string) => {
    if (!id) return;
    setLanes(null);
    setHistory(null);
    getRateCard(id).then(setLanes).catch((e) => toast(errorMessage(e)));
    listRateRevisions(id).then(setHistory).catch((e) => toast(errorMessage(e)));
  };
  useEffect(() => loadClient(clientId), [clientId]);

  const startEdit = (lane: RateCardLane) => {
    setEditing(lane);
    // Pre-filled with the rate in force so the number on screen is the one
    // being changed, not an empty box you have to look up first.
    setNewRate(String(Math.round(lane.ratePaise / 100)));
    setEffectiveFrom(today());
    setReason('');
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
    return null;
  })();

  const laneColumns: Column<RateCardLane>[] = [
    {
      key: 'lane',
      label: 'Route',
      primary: true,
      render: (l) => `${l.origin} → ${l.destination}`,
      sub: (l) => l.truckType,
    },
    { key: 'rate', label: 'Agreed rate', render: (l) => inr(l.ratePaise) },
    {
      key: 'period',
      label: 'In force',
      render: (l) => `${fmtDate(l.validFrom)} — ${l.validTo ? fmtDate(l.validTo) : 'open-ended'}`,
    },
    {
      key: 'go',
      label: '',
      render: (l) =>
        lanesPendingChange.has(`${l.origin} → ${l.destination}·${l.truckType}`) ? (
          <Tag tone="flag" emoji="⏳">
            Change waiting for sign-off
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
  ];

  return (
    <ModuleGuard module="clients">
      <PageHeader
        title="Rate revision"
        sub="Move the price on a lane we have already agreed, with a reason and a sign-off"
        module="clients"
      />
      <PageIntro
        what="Pick a client, pick the lane whose rate is changing, and say what it is changing to and why."
        who="Finance asks for the change. Somebody who can approve a contract has to agree to it before it takes effect."
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
            v: lanes?.length ?? 0,
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
      />

      <Panel pad={false}>
        {!lanes ? (
          <Loading what="Loading the rate card" />
        ) : (
          <DataTable
            columns={laneColumns}
            rows={lanes}
            rowKey={(l) => l.id}
            empty={
              <EmptyState
                emoji="📄"
                title="This client has no agreed rates yet"
                hint="A rate card is written when a rate request is won. Until then there is nothing to change."
              />
            }
          />
        )}
      </Panel>

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

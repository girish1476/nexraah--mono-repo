'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime } from '@/lib/format';
import {
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
  useToast,
} from '@/lib/ui';
import { listTickets, updateTicket } from './apis';
import {
  MIN_DETAIL,
  Ticket,
  TicketQueue,
  TicketStatus,
  TICKET_KIND_LABEL,
  TICKET_SEVERITY_LABEL,
  TICKET_SEVERITY_TONE,
  TICKET_STATUS_EMOJI,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from './types';

const FILTERS: { key: string; label: string; status?: TicketStatus }[] = [
  { key: 'live', label: 'Still open' },
  { key: 'OPEN', label: 'Waiting to be picked up', status: 'OPEN' },
  { key: 'IN_PROGRESS', label: 'Being looked at', status: 'IN_PROGRESS' },
  { key: 'RESOLVED', label: 'Sorted', status: 'RESOLVED' },
  { key: 'WONT_FIX', label: 'Closed without a change', status: 'WONT_FIX' },
];

/**
 * `/tickets` — the ticketing portal.
 *
 * Two screens in one, and the server decides which you get. An administrator
 * sees every report and can act on it; everybody else sees what they raised
 * and can follow it. That split is not a UI choice — reports name records the
 * reader may not be able to open and quote what a colleague got wrong.
 *
 * What it exists for, in the owner's words: "if any wrong data was updated".
 * The audit trail proves what happened and refuses to be edited, which is
 * exactly right and no help at all to somebody looking at a misspelt client
 * name. This is the route from noticing that to somebody correcting it.
 */
export default function TicketsPage() {
  const toast = useToast();
  const [queue, setQueue] = useState<TicketQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('live');
  const [open, setOpen] = useState<Ticket | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    const chosen = FILTERS.find((f) => f.key === filter);
    listTickets({ status: chosen?.status })
      .then(setQueue)
      .catch((e) => setError(errorMessage(e)));
  }, [filter]);

  useEffect(load, [load]);

  const act = async (id: string, body: { status?: TicketStatus; resolution?: string }) => {
    setBusy(true);
    try {
      await updateTicket(id, body);
      toast('Ticket updated. Whoever reported it can see this.');
      setOpen(null);
      setResolution('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!queue) return <Loading what="Loading tickets" />;

  /*
   * "Still open" is the default and is filtered here rather than server-side,
   * because it spans two statuses and the endpoint takes one. Everything else
   * is a real server filter.
   */
  const rows =
    filter === 'live'
      ? queue.rows.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS')
      : queue.rows;

  const columns: Column<Ticket>[] = [
    {
      key: 'what',
      label: 'What was reported',
      primary: true,
      render: (t) => t.subject,
      sub: (t) => `${t.code} · ${TICKET_KIND_LABEL[t.kind]}`,
    },
    {
      key: 'where',
      label: 'Where',
      render: (t) => <code>{t.raisedOnPath}</code>,
      sub: (t) => (t.entityId ? `${t.entityType ?? 'record'} ${t.entityId}` : ''),
    },
    {
      key: 'who',
      label: 'Reported by',
      render: (t) => t.raisedByName ?? '—',
      sub: (t) => `${fmtDateTime(t.createdAt)}${t.branchName ? ` · ${t.branchName}` : ''}`,
    },
    {
      key: 'urgency',
      label: 'Holding them up?',
      render: (t) => (
        <Tag tone={TICKET_SEVERITY_TONE[t.severity]} emoji={t.severity === 'BLOCKING' ? '🛑' : '•'}>
          {TICKET_SEVERITY_LABEL[t.severity]}
        </Tag>
      ),
    },
    {
      key: 'status',
      label: 'Where it stands',
      render: (t) => (
        <Tag tone={TICKET_STATUS_TONE[t.status]} emoji={TICKET_STATUS_EMOJI[t.status]}>
          {TICKET_STATUS_LABEL[t.status]}
        </Tag>
      ),
    },
    {
      key: 'go',
      label: '',
      render: (t) => (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setOpen(t);
            setResolution(t.resolution ?? '');
          }}
        >
          {queue.canResolve ? 'Open' : 'See detail'}
        </button>
      ),
    },
  ];

  return (
    <ModuleGuard module="tickets">
      <PageHeader
        title="Tickets"
        sub="Data problems reported from the screen they were spotted on"
        module="tickets"
      />
      <PageIntro
        what={
          queue.canResolve
            ? 'Every problem anybody has reported, worst and oldest first. Open one to see the screen it came from, then say what you did about it.'
            : 'The problems you have reported, and what has been done about each.'
        }
        who={
          queue.canResolve
            ? 'Administration acts on these. Anyone in the company can raise one.'
            : 'Administration answers these. You can raise one from the bottom of any screen.'
        }
      >
        The Activity log proves what changed and cannot be edited by anyone. This is the
        other half — the way a person who spots something wrong gets it corrected.
      </PageIntro>

      {!queue.canResolve && (
        <div className="hint" style={{ marginBottom: 16 }}>
          Showing the reports you raised. Administration sees all of them.
        </div>
      )}

      <StatStrip
        stats={[
          {
            k: 'Blocking somebody',
            v: queue.summary.blocking,
            emoji: '🛑',
            id: 'tickets-blocking',
            tone: queue.summary.blocking > 0 ? 'red' : undefined,
            note: 'Somebody cannot get on with their work until these are sorted',
          },
          {
            k: 'Waiting to be picked up',
            v: queue.summary.open,
            emoji: '📥',
            id: 'tickets-open',
            tone: queue.summary.open > 0 ? 'flag' : undefined,
            note: 'Reported, nobody has started on them',
          },
          {
            k: 'Being looked at',
            v: queue.summary.inProgress,
            emoji: '🔧',
            id: 'tickets-progress',
            note: 'Somebody has picked these up',
          },
          {
            k: 'Longest wait',
            v: queue.summary.oldestOpenDays === null ? '—' : `${queue.summary.oldestOpenDays}d`,
            emoji: '⏳',
            id: 'tickets-oldest',
            tone: (queue.summary.oldestOpenDays ?? 0) > 7 ? 'red' : undefined,
            note: 'How long the oldest unfinished report has been waiting',
          },
        ]}
      />

      <SectionHead emoji="🎫" title="Reports" note="Blocking first, then whatever has waited longest" />

      <Panel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={filter === f.key ? 'btn btn-sm' : 'btn btn-secondary btn-sm'}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel pad={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          empty={
            <EmptyState
              emoji="🎉"
              title={filter === 'live' ? 'Nothing outstanding' : 'Nothing here'}
              hint={
                queue.canResolve
                  ? 'A report lands here the moment anybody presses “Report a problem” at the bottom of a screen.'
                  : 'You have not reported anything in this state. Use “Report a problem” at the bottom of any screen.'
              }
            />
          }
        />
      </Panel>

      {/* ---- one report ---------------------------------------------------- */}
      <Dialog
        open={Boolean(open)}
        title={open ? `${open.code} · ${open.subject}` : ''}
        confirmLabel="Close"
        onConfirm={() => setOpen(null)}
        onClose={() => setOpen(null)}
      >
        {open && (
          <Stack gap={14}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag tone={TICKET_STATUS_TONE[open.status]} emoji={TICKET_STATUS_EMOJI[open.status]}>
                {TICKET_STATUS_LABEL[open.status]}
              </Tag>
              <Tag tone={TICKET_SEVERITY_TONE[open.severity]} emoji="•">
                {TICKET_SEVERITY_LABEL[open.severity]}
              </Tag>
            </div>

            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                What was reported
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{open.detail}</p>
            </div>

            <div className="hint">
              Reported by {open.raisedByName ?? 'somebody'} on {fmtDateTime(open.createdAt)} from{' '}
              <Link href={open.raisedOnPath}>{open.raisedOnPath}</Link>
              {open.entityId ? ` · ${open.entityType ?? 'record'} ${open.entityId}` : ''}
            </div>

            {open.resolution && (
              <div
                className="surface"
                style={{ padding: '12px 14px', borderLeft: '3px solid var(--mint)' }}
              >
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  What was done
                </div>
                <p style={{ whiteSpace: 'pre-wrap' }}>{open.resolution}</p>
                {open.resolvedByName && (
                  <p className="hint" style={{ marginTop: 6 }}>
                    {open.resolvedByName}
                    {open.resolvedAt ? ` · ${fmtDateTime(open.resolvedAt)}` : ''}
                  </p>
                )}
              </div>
            )}

            {queue.canResolve && (
              <>
                {open.status === 'OPEN' && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => act(open.id, { status: 'IN_PROGRESS' })}
                  >
                    🔧 I am looking at this
                  </button>
                )}

                {open.status !== 'RESOLVED' && open.status !== 'WONT_FIX' && (
                  <Field
                    label="What did you do about it?"
                    required
                    hint="The person who reported it reads this. “Fixed” tells them nothing, so it is refused."
                  >
                    <textarea
                      rows={3}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="e.g. Corrected the client name on CLT-0092 and re-issued NEX-INV-000214."
                    />
                  </Field>
                )}

                {open.status !== 'RESOLVED' && open.status !== 'WONT_FIX' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn"
                      disabled={busy || resolution.trim().length < MIN_DETAIL}
                      onClick={() => act(open.id, { status: 'RESOLVED', resolution: resolution.trim() })}
                    >
                      ✅ Sorted
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busy || resolution.trim().length < MIN_DETAIL}
                      onClick={() => act(open.id, { status: 'WONT_FIX', resolution: resolution.trim() })}
                    >
                      🚫 Closing without a change
                    </button>
                  </div>
                )}

                {(open.status === 'RESOLVED' || open.status === 'WONT_FIX') && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => act(open.id, { status: 'OPEN' })}
                  >
                    ↩︎ Reopen — this was closed by mistake
                  </button>
                )}
              </>
            )}
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}

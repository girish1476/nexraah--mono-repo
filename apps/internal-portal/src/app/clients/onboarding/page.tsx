'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate } from '@/lib/format';
import {
  ActionCard,
  AllClear,
  BlockedPanel,
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Glyph,
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
import {
  activateClient,
  decideClientDocument,
  getClientOnboarding,
  listClientOnboarding,
  rejectClient,
  submitClientDocument,
} from './apis';
import {
  CLIENT_STATUS_EMOJI,
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_TONE,
  ClientOnboardingDetail,
  ClientOnboardingDocument,
  ClientOnboardingRow,
} from './types';

/** What a paper's state should look like, in words rather than enum names. */
const DOC_TONE = {
  MISSING: 'grey',
  PENDING: 'flag',
  VERIFIED: 'mint',
  REJECTED: 'red',
} as const;

const DOC_LABEL = {
  MISSING: 'Not sent yet',
  PENDING: 'Waiting to be checked',
  VERIFIED: 'Checked and accepted',
  REJECTED: 'Rejected',
} as const;

const DOC_EMOJI = { MISSING: '⬜', PENDING: '🔍', VERIFIED: '✅', REJECTED: '⛔' } as const;

/**
 * `/clients/onboarding` — Compliance decides whether we carry for a client.
 *
 * The supply side has had this shape for a while: a transporter cannot be
 * given loads until Compliance clears their documents. The demand side had
 * nothing — a client was created straight to ACTIVE and work could be booked
 * against them immediately, with no papers and nobody's sign-off. This is the
 * other half of that rule, built to look like its twin on purpose.
 *
 * Deliberately a queue rather than a form. The question the desk arrives with
 * is "who is waiting on me", not "let me look up a client", so the list leads
 * and a client's checklist opens from it.
 */
export default function ClientOnboardingPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<ClientOnboardingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ClientOnboardingDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<{ kind?: string } | null>(null);
  const [reason, setReason] = useState('');

  const load = () => {
    setError(null);
    listClientOnboarding().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const openClient = async (id: string) => {
    try {
      setOpen(await getClientOnboarding(id));
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  /** Every mutation refreshes both the open file and the queue behind it. */
  const run = async (fn: () => Promise<ClientOnboardingDetail>) => {
    setBusy(true);
    try {
      setOpen(await fn());
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading the onboarding queue" />;

  const waiting = rows.filter((r) => r.status === 'PENDING_VERIFICATION');
  const drafts = rows.filter((r) => r.status === 'DRAFT');
  const declined = rows.filter((r) => r.status === 'REJECTED');
  const readyToClear = rows.filter((r) => r.canActivate && r.status !== 'REJECTED');

  const columns: Column<ClientOnboardingRow>[] = [
    {
      key: 'client',
      label: 'Client',
      primary: true,
      render: (r) => r.name,
      sub: (r) =>
        `${r.billingCity} · ${r.engagement === 'CONTRACT' ? 'contract' : 'spot'} · ${r.code}`,
    },
    {
      key: 'papers',
      label: 'Papers checked',
      render: (r) => (
        <Tag tone={r.cleared === r.required ? 'mint' : r.cleared === 0 ? 'red' : 'flag'} emoji="📄">
          {r.cleared} of {r.required}
        </Tag>
      ),
    },
    {
      key: 'status',
      label: 'Where it stands',
      render: (r) => (
        <Tag tone={CLIENT_STATUS_TONE[r.status]} emoji={CLIENT_STATUS_EMOJI[r.status]}>
          {CLIENT_STATUS_LABEL[r.status]}
        </Tag>
      ),
    },
    { key: 'since', label: 'Waiting since', render: (r) => (r.createdAt ? fmtDate(r.createdAt) : '—') },
    {
      key: 'go',
      label: '',
      render: (r) => (
        <button className="btn btn-secondary btn-sm" onClick={() => openClient(r.id)}>
          Open file
        </button>
      ),
    },
  ];

  return (
    <ModuleGuard module="clients">
      <PageHeader
        title="Client onboarding"
        sub="Check a new client’s papers before we carry for them"
        module="clients"
      />
      <PageIntro
        what="Every client waiting to be cleared. Check their papers, then either clear them for work or decline them with a reason."
        who="Compliance does this. Until a client is cleared, no load can be raised against them."
      >
        The same rule as the supply side: a transporter cannot be given loads until their documents
        are checked, and now a client cannot be given work until theirs are.
      </PageIntro>

      <StatStrip
        stats={[
          {
            k: 'Waiting on you',
            v: waiting.length,
            emoji: '🔍',
            id: 'onboarding-waiting',
            tone: waiting.length > 0 ? 'flag' : undefined,
            note: 'Papers are in and need checking',
          },
          {
            k: 'Ready to clear',
            v: readyToClear.length,
            emoji: '✅',
            id: 'onboarding-ready',
            tone: readyToClear.length > 0 ? 'mint' : undefined,
            note: 'Every paper checked — one click to approve',
          },
          {
            k: 'Still being set up',
            v: drafts.length,
            emoji: '📝',
            id: 'onboarding-drafts',
            note: 'Signed up, no papers sent yet',
          },
          {
            k: 'Declined',
            v: declined.length,
            emoji: '⛔',
            id: 'onboarding-declined',
            tone: declined.length > 0 ? 'red' : undefined,
            note: 'We will not carry for these',
          },
        ]}
      />

      {readyToClear.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <ActionCard
            emoji="✅"
            tone="mint"
            count={readyToClear.length}
            title={`client${readyToClear.length === 1 ? ' has' : 's have'} every paper checked`}
            why="Nothing is outstanding on these — open the file and clear them so work can be booked."
          />
        </div>
      )}

      <SectionHead emoji="📋" title="The queue" note="Oldest first — longest wait at the top" />

      <Panel pad={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => openClient(r.id)}
          empty={
            <EmptyState
              emoji="🎉"
              title="Nobody is waiting to be onboarded"
              hint="A client appears here as soon as Finance signs them up. You check their papers, then clear them so loads can be raised against them."
            />
          }
        />
      </Panel>

      {/* ---- one client's file ------------------------------------------- */}
      <Dialog
        open={Boolean(open) && !rejecting}
        title={open ? `${open.name} · ${open.code}` : ''}
        confirmLabel="Clear this client"
        confirmDisabled={!open?.gate.canActivate || !can('client.onboard')}
        busy={busy}
        onConfirm={() => open && run(() => activateClient(open.id))}
        onClose={() => setOpen(null)}
      >
        {open && (
          <Stack gap={14}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag tone={CLIENT_STATUS_TONE[open.status]} emoji={CLIENT_STATUS_EMOJI[open.status]}>
                {CLIENT_STATUS_LABEL[open.status]}
              </Tag>
              <span className="hint">
                {open.billingCity} · {open.engagement === 'CONTRACT' ? 'contract' : 'spot'} client
                {open.gstin ? ` · GSTIN ${open.gstin}` : ''}
              </span>
            </div>

            {open.status === 'REJECTED' && open.rejectionReason && (
              <div className="hint" style={{ color: 'var(--red)' }}>
                ⛔ Declined — {open.rejectionReason}
              </div>
            )}

            {/*
              The checklist comes from the server, so the rule about which
              papers a client owes lives in one place. A spot client is not
              asked for a rate agreement, and this screen does not need to
              know that — it just renders what it is told.
            */}
            <BlockedPanel
              title={open.gate.canActivate ? 'Every paper is checked' : 'Still outstanding'}
              subtitle={
                open.gate.canActivate
                  ? 'This client can be cleared for work.'
                  : 'These have to be settled before the client can be cleared.'
              }
              unmet={open.gate.unmet}
              cleared={open.gate.cleared}
            />

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Their papers
              </div>
              <Stack gap={8}>
                {open.documents.map((doc: ClientOnboardingDocument) => (
                  <div
                    key={doc.kind}
                    className="surface"
                    style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Glyph size={16}>{DOC_EMOJI[doc.status]}</Glyph>
                    <span style={{ flex: 1, minWidth: 150 }}>
                      <span style={{ fontWeight: 600 }}>{doc.label}</span>
                      <span className="hint" style={{ display: 'block' }}>
                        {DOC_LABEL[doc.status]}
                        {doc.rejectReason ? ` — ${doc.rejectReason}` : ''}
                        {doc.verifiedByName ? ` · by ${doc.verifiedByName}` : ''}
                      </span>
                    </span>
                    <Tag tone={DOC_TONE[doc.status]}>{DOC_LABEL[doc.status]}</Tag>

                    {can('client.onboard') && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        {doc.status === 'MISSING' ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() =>
                              run(() => submitClientDocument(open.id, { kind: doc.kind, reference: 'Logged by Compliance' }))
                            }
                          >
                            Mark received
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn btn-sm"
                              disabled={busy || doc.status === 'VERIFIED'}
                              onClick={() => run(() => decideClientDocument(open.id, doc.kind, { status: 'VERIFIED' }))}
                            >
                              Accept
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => {
                                setReason('');
                                setRejecting({ kind: doc.kind });
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </Stack>
            </div>

            {can('client.onboard') && open.status !== 'REJECTED' && (
              <button
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => {
                  setReason('');
                  setRejecting({});
                }}
              >
                ⛔ Decline this client
              </button>
            )}
          </Stack>
        )}
      </Dialog>

      {/* ---- a rejection always carries a reason -------------------------- */}
      <Dialog
        open={Boolean(rejecting)}
        title={rejecting?.kind ? 'Reject this document' : 'Decline this client'}
        body={
          rejecting?.kind
            ? 'Say what is wrong with it. The client is told, so it has to be something they can act on.'
            : 'Say why we will not carry for them. It is recorded against the client and shown whenever their file is opened.'
        }
        confirmLabel={rejecting?.kind ? 'Reject the document' : 'Decline the client'}
        confirmDisabled={reason.trim().length < 10}
        busy={busy}
        onConfirm={async () => {
          if (!open || !rejecting) return;
          const kind = rejecting.kind;
          setRejecting(null);
          await run(() =>
            kind
              ? decideClientDocument(open.id, kind as never, { status: 'REJECTED', reason })
              : rejectClient(open.id, reason),
          );
        }}
        onClose={() => setRejecting(null)}
      >
        <Field label="Reason" required hint="At least a sentence — it is what the client is told.">
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>

      {rows.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <AllClear emoji="🎉">
            <strong>Nothing waiting.</strong> Every client we have signed up has been checked and
            cleared.
          </AllClear>
        </div>
      )}
    </ModuleGuard>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApprovalRequiredError, errorMessage, request } from '@/apis';
import { DOC_GROUPS, docLabel } from '@/lib/documents';
import { fmtDateTime } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import {
  getCrossCheck,
  getTripDocuments,
  overrideCrossCheck,
  rejectTripDocument,
  uploadTripDocument,
  verifyTripDocument,
} from '../../apis';
import { CrossCheckResult, DocStatus, TripDocument } from '../../types';
import { TripTabs } from '../tabs';

const DOC_TONE: Record<DocStatus, Tone> = {
  MISSING: 'red',
  PENDING: 'flag',
  VERIFIED: 'mint',
  REJECTED: 'red',
};

/**
 * Documents tab — `/trips/[id]/documents` (part 05 §3).
 *
 * Five groups, eleven documents. Eight gate the advance, and fitness, permit
 * and PUC are in that set. A cross-check mismatch blocks LR generation until
 * it is rejected or overridden — catching it after dispatch catches nothing.
 */
export default function TripDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();

  const [docs, setDocs] = useState<TripDocument[] | null>(null);
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<TripDocument | null>(null);
  const [reason, setReason] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([getTripDocuments(id), getCrossCheck(id)])
      .then(([d, c]) => {
        setDocs(d);
        setCrossCheck(c);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const upload = async (doc: TripDocument) => {
    try {
      const { id: attachmentId } = await request<{ id: string }>({
        url: '/attachments',
        method: 'POST',
        data: { kind: doc.kind, entityType: 'trip', entityId: id },
      });
      await uploadTripDocument(id, doc.kind, { attachmentId });
      toast(`${doc.label} uploaded · sent to whoever holds document.verify`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const verify = async (doc: TripDocument) => {
    try {
      await verifyTripDocument(id, doc.kind);
      toast(`Verified · ${doc.label}`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await rejectTripDocument(id, rejecting.kind, reason);
      toast(`Rejected · ${rejecting.label} · re-upload requested`);
      setRejecting(null);
      setReason('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doOverride = async () => {
    setBusy(true);
    try {
      await overrideCrossCheck(id, overrideReason);
      toast('Override requested');
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        toast(`Sent to ${e.approval.approverRole} · the mismatch stays open until it is approved`);
        setOverrideOpen(false);
        setOverrideReason('');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!docs) return <Loading what="Loading documents" />;

  const columns: Column<TripDocument>[] = [
    {
      key: 'name',
      label: 'Document',
      render: (r) => (
        <div>
          <div>{r.label || docLabel(r.kind)}</div>
          {r.gatesAdvance && (
            <span className="muted" style={{ fontSize: 11 }}>
              gates the advance
            </span>
          )}
          {r.rejectReason && (
            <div style={{ color: 'var(--red)', fontSize: 11.5 }}>Rejected: {r.rejectReason}</div>
          )}
        </div>
      ),
    },
    { key: 'uploaded', label: 'Uploaded', render: (r) => fmtDateTime(r.uploadedAt) },
    {
      key: 'verified',
      label: 'Verified by',
      render: (r) => (r.verifiedBy ? `${r.verifiedBy} · ${fmtDateTime(r.verifiedAt)}` : <span className="muted">—</span>),
    },
    { key: 'state', label: 'State', render: (r) => <Tag tone={DOC_TONE[r.status]}>{r.status}</Tag> },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => {
        if (r.status === 'MISSING' || r.status === 'REJECTED')
          return can('document.verify') || can('indent.manage') ? (
            <button className="btn btn-secondary btn-sm" onClick={() => upload(r)}>
              Upload
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 11.5 }}>
              OPS uploads
            </span>
          );
        if (r.status === 'PENDING')
          return can('document.verify') ? (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setRejecting(r)}>
                Reject
              </button>
              <button className="btn btn-sm" onClick={() => verify(r)}>
                Verify
              </button>
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Awaiting verification
            </span>
          );
        return <span className="muted">—</span>;
      },
    },
  ];

  return (
    <ModuleGuard module="trips">
      <PageHeader
        path={`/trips/${id}/documents`}
        title="Trip documents"
        sub="Eleven documents in five groups. Eight of them gate the advance (BR-58)."
        module="trips"
      />
      <TripTabs tripId={id} />

      <Stack>
        {crossCheck && !crossCheck.runnable && (
          <Banner tone="grey" title="Cross-check not yet runnable">
            Waiting on {crossCheck.waitingOn.join(', ').toLowerCase() || 'the remaining documents'}. The check runs
            when the client invoice, the e-way bill and the lorry receipt are all present.
          </Banner>
        )}

        {crossCheck && crossCheck.runnable && crossCheck.mismatches.length === 0 && (
          <Banner tone="mint" title="Cross-check clear">
            Invoice number and value, vehicle number, consignor GSTIN and e-way validity all agree.
          </Banner>
        )}

        {crossCheck && crossCheck.mismatches.length > 0 && (
          <Panel>
            <Banner
              tone="red"
              title={`${crossCheck.mismatches.length} cross-check mismatch${crossCheck.mismatches.length === 1 ? '' : 'es'}`}
              right={
                <div style={{ display: 'flex', gap: 7 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setOverrideOpen(true)}>
                    Override and proceed
                  </button>
                </div>
              }
            >
              A mismatch is penalised at a checkpost, so it must be caught before dispatch. `Generate LR` and the
              placement-complete action stay blocked until this is rejected or overridden (BR-32, BR-44).
            </Banner>
            <div style={{ marginTop: 12 }}>
              {crossCheck.mismatches.map((m) => (
                <div
                  key={m.field}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 10,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--color-divider)',
                  }}
                >
                  <div style={{ fontSize: 13 }}>{m.field}</div>
                  <div>
                    <div className="eyebrow">{m.a.source}</div>
                    <div className="mono" style={{ fontSize: 12.5 }}>
                      {m.a.value || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">{m.b.source}</div>
                    <div className="mono" style={{ fontSize: 12.5, color: 'var(--red)' }}>
                      {m.b.value || '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {DOC_GROUPS.map((group) => {
          const rows = docs.filter((d) => group.kinds.includes(d.kind));
          if (rows.length === 0) return null;
          return (
            <Panel
              key={group.key}
              title={group.label}
              right={
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {rows.filter((r) => r.status === 'VERIFIED').length} of {rows.length} verified
                </span>
              }
              pad={false}
            >
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.kind} />
            </Panel>
          );
        })}
      </Stack>

      <Dialog
        open={!!rejecting}
        title={`Reject ${rejecting?.label ?? ''}`}
        body="The transporter is asked to re-upload. The rejection and its reason are written to the audit trail."
        confirmLabel="Reject and request re-upload"
        confirmDisabled={!reason.trim()}
        busy={busy}
        onConfirm={doReject}
        onClose={() => setRejecting(null)}
      >
        <Field label="Reason" required>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={overrideOpen}
        title="Override the cross-check"
        body="An override does not correct the document — it proceeds in spite of it. It needs a role senior to operations and is recorded as an OVERRIDE audit event. Where the error is ours, correct it in the system instead."
        confirmLabel="Request override"
        confirmDisabled={overrideReason.trim().length < 20}
        busy={busy}
        onConfirm={doOverride}
        onClose={() => setOverrideOpen(false)}
      >
        <Field label="Reason" required hint="At least 20 characters (BR-44).">
          <textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

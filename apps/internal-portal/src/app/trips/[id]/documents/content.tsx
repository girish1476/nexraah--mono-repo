'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { ApprovalRequiredError, errorMessage, request } from '@/apis';
import { useAtomValue } from 'jotai';
import { sessionAtom } from '@/store/atoms';
import { DOC_GROUPS, docLabel } from '@/lib/documents';
import { fmtDateTime } from '@/lib/format';
import { ROLES } from '@/lib/permissions';
import {
  Banner,
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Loading,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import {
  getCrossCheck,
  getTrip,
  getTripDocuments,
  overrideCrossCheck,
  rejectTripDocument,
  uploadTripDocument,
  verifyTripDocument,
} from '../../apis';
import { CrossCheckResult, DocStatus, TripDocument } from '../../types';

const DOC_TONE: Record<DocStatus, Tone> = {
  MISSING: 'red',
  PENDING: 'flag',
  VERIFIED: 'mint',
  REJECTED: 'red',
};

/**
 * The whole of `/trips/[id]/documents`, minus its own `PageHeader`/`PageIntro`/
 * `TripTabs` chrome — extracted so the order detail page (part 04, the
 * "everything about one order, one screen, no redirects" rebuild) can embed
 * this exact upload/verify/reject/cross-check workflow inside its own
 * Documents tab, rather than sending someone here to do it. The route itself
 * (`page.tsx`, right below) still renders this unchanged, so every existing
 * link to it and every test pinned against it keeps working.
 */
export function TripDocumentsContent({ tripId }: { tripId: string }) {
  const can = useCan();
  const toast = useToast();
  const session = useAtomValue(sessionAtom);
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  // The proof of delivery comes after unloading — its row is not offered before.
  const [unloaded, setUnloaded] = useState(false);

  const [docs, setDocs] = useState<TripDocument[] | null>(null);
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<TripDocument | null>(null);
  const [reason, setReason] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDoc, setPendingDoc] = useState<TripDocument | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keyedDoc, setKeyedDoc] = useState<TripDocument | null>(null);
  const [keyedFile, setKeyedFile] = useState<File | null>(null);
  const [keyedForm, setKeyedForm] = useState<Record<string, string>>({});

  const load = () => {
    setError(null);
    Promise.all([getTripDocuments(tripId), getCrossCheck(tripId), getTrip(tripId)])
      .then(([d, c, t]) => {
        setDocs(d);
        setCrossCheck(c);
        setSupervisorId(t.loadingSupervisorId ?? null);
        setUnloaded(!!t.deliveredAt);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [tripId]);

  // Operations and the document desk upload any document. So does the trip's own
  // loading supervisor: the advance documents and the unloading ones alike.
  // Compliance verifies whatever they upload.
  const isSupervisor = !!session && supervisorId !== null && supervisorId === session.userId;
  const canUpload = (_doc: TripDocument) => can('document.verify') || can('indent.manage') || isSupervisor;

  const upload = (doc: TripDocument) => {
    setPendingDoc(doc);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const doc = pendingDoc;
    e.target.value = '';
    if (!file || !doc) return;
    if (doc.kind === 'CLIENT_INVOICE_OR_PO' || doc.kind === 'EWAY_BILL') {
      setKeyedDoc(doc);
      setKeyedFile(file);
      setKeyedForm({});
      setPendingDoc(null);
      return;
    }
    await doUpload(doc, file);
  };

  const doUpload = async (doc: TripDocument, file: File, keyedValues?: Record<string, string>) => {
    setUploading(doc.kind);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', doc.kind);
      formData.append('entityType', 'trip');
      formData.append('entityId', tripId);
      const { id: attachmentId } = await request<{ id: string }>({
        url: '/attachments',
        method: 'POST',
        data: formData,
      });
      await uploadTripDocument(tripId, doc.kind, { attachmentId, keyedValues });
      toast(`${doc.label} uploaded · sent for verification`);
      load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setUploading(null);
      setPendingDoc(null);
    }
  };

  const submitKeyed = async () => {
    if (!keyedDoc || !keyedFile) return;
    const keyedValues: Record<string, string> =
      keyedDoc.kind === 'CLIENT_INVOICE_OR_PO'
        ? {
            invoiceNo: (keyedForm.invoiceNo ?? '').trim(),
            invoiceValue: String(Math.round(Number(keyedForm.invoiceValueRupees || 0) * 100)),
            consignorGstin: (keyedForm.consignorGstin ?? '').trim().toUpperCase(),
            consigneeName: (keyedForm.consigneeName ?? '').trim(),
          }
        : {
            vehicleNo: (keyedForm.vehicleNo ?? '').trim().toUpperCase(),
            validTill: keyedForm.validTill ?? '',
          };
    const doc = keyedDoc;
    const file = keyedFile;
    setKeyedDoc(null);
    setKeyedFile(null);
    await doUpload(doc, file, keyedValues);
  };

  const verify = async (doc: TripDocument) => {
    try {
      await verifyTripDocument(tripId, doc.kind);
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
      await rejectTripDocument(tripId, rejecting.kind, reason);
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
      await overrideCrossCheck(tripId, overrideReason);
      toast('Override requested');
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        const approverLabel =
          (ROLES as Record<string, { label: string }>)[e.approval.approverRole]?.label ?? e.approval.approverRole;
        toast(`Sent to ${approverLabel} · the mismatch stays open until it is approved`);
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
          return canUpload(r) ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => upload(r)}
              disabled={uploading !== null}
            >
              {uploading === r.kind ? 'Uploading…' : 'Upload'}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 11.5 }}>
              The loading supervisor or {ROLES.OPS.label} uploads
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
        // VERIFIED — a verified document was still a real upload, and real
        // documents expire or turn out to be the wrong page. Re-uploading
        // sends it back through the same verification step rather than
        // leaving a stale file as the record's last word with no way to
        // correct it short of a ticket to Administration.
        return canUpload(r) ? (
          <button className="btn btn-secondary btn-sm" onClick={() => upload(r)} disabled={uploading !== null}>
            {uploading === r.kind ? 'Uploading…' : 'Replace'}
          </button>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
  ];

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={onFileChosen}
        style={{ display: 'none' }}
      />

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
              A mismatch is penalised at a checkpost, so it must be caught before dispatch. Generate LR and
              completing placement stay blocked until this mismatch is either rejected or overridden.
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
                  <div style={{ fontSize: 13 }}>{docLabel(m.field)}</div>
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

        {DOC_GROUPS.filter((group) => group.key !== 'POD' || unloaded).map((group) => {
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
        <Field label="Reason" required hint="At least 20 characters.">
          <textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={!!keyedDoc}
        title={`Key in details for ${keyedDoc?.label ?? ''}`}
        body="Type exactly what the document says — these values are what the cross-check compares against the lorry receipt."
        confirmLabel="Upload"
        confirmDisabled={
          keyedDoc?.kind === 'CLIENT_INVOICE_OR_PO'
            ? !keyedForm.invoiceNo?.trim() || !keyedForm.invoiceValueRupees
            : !keyedForm.vehicleNo?.trim() || !keyedForm.validTill
        }
        busy={uploading !== null}
        onConfirm={submitKeyed}
        onClose={() => {
          setKeyedDoc(null);
          setKeyedFile(null);
        }}
      >
        {keyedDoc?.kind === 'CLIENT_INVOICE_OR_PO' ? (
          <>
            <Field label="Invoice number" required>
              <input
                value={keyedForm.invoiceNo ?? ''}
                onChange={(e) => setKeyedForm({ ...keyedForm, invoiceNo: e.target.value })}
              />
            </Field>
            <Field label="Invoice value (₹)" required>
              <input
                type="number"
                value={keyedForm.invoiceValueRupees ?? ''}
                onChange={(e) => setKeyedForm({ ...keyedForm, invoiceValueRupees: e.target.value })}
              />
            </Field>
            <Field label="Consignor GSTIN">
              <input
                value={keyedForm.consignorGstin ?? ''}
                onChange={(e) => setKeyedForm({ ...keyedForm, consignorGstin: e.target.value })}
              />
            </Field>
            <Field label="Consignee name">
              <input
                value={keyedForm.consigneeName ?? ''}
                onChange={(e) => setKeyedForm({ ...keyedForm, consigneeName: e.target.value })}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Vehicle number" required>
              <input
                value={keyedForm.vehicleNo ?? ''}
                onChange={(e) => setKeyedForm({ ...keyedForm, vehicleNo: e.target.value })}
              />
            </Field>
            <Field label="Valid till" required>
              <input
                type="date"
                value={keyedForm.validTill ?? ''}
                onChange={(e) => setKeyedForm({ ...keyedForm, validTill: e.target.value })}
              />
            </Field>
          </>
        )}
      </Dialog>
    </>
  );
}

'use client';

import { ChangeEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ApprovalRequiredError, errorMessage } from '@/apis';
import { DocPreview } from '@/components/doc-preview';
import { LorryReceiptContent } from '@/app/trips/[id]/lr/content';
import { PodVerifyContent } from '@/app/pod/[id]/verify/content';
import {
  getCrossCheck,
  getTrip,
  getTripDocuments,
  overrideCrossCheck,
  rejectTripDocument,
  uploadTripDocument,
  verifyTripDocument,
} from '@/app/trips/apis';
import type { CrossCheckResult, TripDetail, TripDocument } from '@/app/trips/types';
import { getClient } from '@/app/clients/apis';
import type { Client } from '@/app/clients/types';
import { uploadAttachment } from '@/lib/attachments';
import { fmtDate, inr } from '@/lib/format';
import { Banner, Dialog, ErrorState, Field, FormGrid, Loading, Panel, Stack, Tag, useCan, useToast } from '@/lib/ui';
import { sessionAtom } from '@/store/atoms';

/** A detail read off the document and typed in against it. */
interface DetailField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'rupees' | 'number';
  required?: boolean;
  /** Which document kind the value is stored on, for a card that covers several (the vehicle PDF). */
  kind?: string;
  /** The key it is stored under on that kind, when it differs from `key`. */
  storeAs?: string;
}

/** One card on the Documents tab — one file, and the details that go with it. */
interface DocItem {
  id: string;
  title: string;
  /** The trip document kinds this one file stands for. */
  kinds: string[];
  fields: DetailField[];
  /** The vehicle papers come as one PDF, not photos. */
  pdf?: boolean;
  hint?: string;
}

const SECTIONS: { title: string; note: string; items: DocItem[] }[] = [
  {
    title: '🧾 Client documents',
    note: 'The client’s invoice and the e-way bill for this load.',
    items: [
      {
        id: 'invoice',
        title: 'Client invoice or purchase order',
        kinds: ['CLIENT_INVOICE_OR_PO'],
        fields: [
          { key: 'invoiceNo', label: 'Invoice number', required: true },
          { key: 'invoiceValue', label: 'Invoice value (₹)', type: 'rupees', required: true },
          { key: 'consignorGstin', label: 'Consignor GSTIN' },
          { key: 'consigneeName', label: 'Consignee name' },
        ],
      },
      {
        id: 'eway',
        title: 'E-way bill',
        kinds: ['EWAY_BILL'],
        fields: [
          { key: 'ewayNo', label: 'E-way bill number' },
          { key: 'vehicleNo', label: 'Vehicle number on it', required: true },
          { key: 'validTill', label: 'Valid till', type: 'date', required: true },
        ],
      },
    ],
  },
  {
    title: '🚛 Vehicle documents',
    note: 'One PDF with the RC, permit, insurance, fitness and pollution certificates — not each uploaded separately. Type the numbers and dates from it.',
    items: [
      {
        id: 'vehicle',
        title: 'Vehicle papers (one PDF)',
        kinds: ['RC', 'INSURANCE', 'FITNESS', 'PERMIT', 'PUC'],
        pdf: true,
        fields: [
          { key: 'rcNo', label: 'RC number', required: true, kind: 'RC' },
          { key: 'permitValidTill', label: 'Permit valid till', type: 'date', required: true, kind: 'PERMIT', storeAs: 'validTill' },
          { key: 'insuranceValidTill', label: 'Insurance (IC) valid till', type: 'date', required: true, kind: 'INSURANCE', storeAs: 'validTill' },
          { key: 'fitnessValidTill', label: 'Fitness valid till', type: 'date', required: true, kind: 'FITNESS', storeAs: 'validTill' },
          { key: 'pucValidTill', label: 'Pollution (PUC) valid till', type: 'date', kind: 'PUC', storeAs: 'validTill' },
        ],
      },
    ],
  },
  {
    title: '🪪 Driver',
    note: 'The driving licence of the driver on this trip.',
    items: [
      {
        id: 'dl',
        title: 'Driving licence',
        kinds: ['DRIVING_LICENCE'],
        fields: [
          { key: 'dlNo', label: 'Licence number', required: true },
          { key: 'validTill', label: 'Valid till', type: 'date', required: true },
          { key: 'driverName', label: 'Driver name' },
        ],
      },
    ],
  },
  {
    title: '📦 Loading',
    note: 'Slips from the loading point. With the loading slip in, no lorry receipt is needed — generate an E-LR from it only if the client asks for one.',
    items: [
      {
        id: 'loading-slip',
        title: 'Loading slip',
        kinds: ['LOADING_SLIP'],
        fields: [
          { key: 'packages', label: 'Packages loaded', type: 'number' },
          { key: 'loadedWeightTn', label: 'Weight loaded (MT)', type: 'number' },
        ],
      },
      {
        id: 'weighment',
        title: 'Weighment slip',
        kinds: ['WEIGHMENT_SLIP'],
        fields: [
          { key: 'slipNo', label: 'Slip number' },
          { key: 'netWeightTn', label: 'Net weight (MT)', type: 'number' },
        ],
      },
    ],
  },
];

const STATE: Record<string, { tone: 'mint' | 'flag' | 'red' | 'grey'; label: string }> = {
  MISSING: { tone: 'grey', label: 'Not uploaded' },
  PENDING: { tone: 'flag', label: 'Waiting for check' },
  VERIFIED: { tone: 'mint', label: 'Verified' },
  REJECTED: { tone: 'red', label: 'Rejected — upload again' },
  MIXED: { tone: 'flag', label: 'Partly checked' },
};

/** The state of a card covering several kinds: the weakest of them. */
function stateOf(docs: TripDocument[]): string {
  if (docs.length === 0 || docs.every((d) => d.status === 'MISSING')) return 'MISSING';
  if (docs.some((d) => d.status === 'REJECTED')) return 'REJECTED';
  if (docs.every((d) => d.status === 'VERIFIED')) return 'VERIFIED';
  if (docs.some((d) => d.status === 'VERIFIED')) return 'MIXED';
  return 'PENDING';
}

function valueOf(item: DocItem, f: DetailField, docs: TripDocument[]): string {
  const doc = docs.find((d) => d.kind === (f.kind ?? item.kinds[0]));
  const raw = doc?.keyedValues?.[f.storeAs ?? f.key];
  return raw === undefined || raw === null ? '' : String(raw);
}

function shown(f: DetailField, raw: string): ReactNode {
  if (!raw) return <span className="muted">—</span>;
  if (f.type === 'rupees') return inr(Number(raw));
  if (f.type === 'date') return fmtDate(raw);
  return raw;
}

/**
 * The order's Documents tab.
 *
 * Each document is a card: the uploaded photo (or, for the vehicle papers,
 * the PDF) on the left, and the details that matter on it — numbers, values,
 * validity dates — on the right. Who uploaded it and who verified it, and
 * when, are on the Details tab, not here.
 *
 * The advance documents are uploaded once the truck is loaded — the order
 * cycle the operations team works to — and the proof of delivery once it is
 * unloaded, as an E-POD or an H-POD.
 */
export function OrderDocumentsTab({
  tripId,
  onChanged,
  openTracking,
  onLrLoaded,
  showLr = true,
  showPod = true,
}: {
  tripId: string;
  onChanged: () => void;
  /** Absent on the trip page, which has no Tracking tab. */
  openTracking?: () => void;
  onLrLoaded?: (code: string | null) => void;
  /** The trip page has its own LR tab and POD route, so it leaves these out. */
  showLr?: boolean;
  showPod?: boolean;
}) {
  const can = useCan();
  const toast = useToast();
  const session = useAtomValue(sessionAtom);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [docs, setDocs] = useState<TripDocument[] | null>(null);
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The upload dialog: a file chosen, the details typed from it.
  const [editing, setEditing] = useState<DocItem | null>(null);
  /** The document the verification team is checking, with its details being typed. */
  const [checking, setChecking] = useState<DocItem | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<DocItem | null>(null);
  const [reason, setReason] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // The client's own rules: whether they want a weighment slip with each load.
  const [client, setClient] = useState<Client | null>(null);
  // The E-LR is opened from the loading slip, only when someone wants one.
  const [lrOpen, setLrOpen] = useState(false);
  // A weighment slip for a client that does not need one — uploaded anyway.
  const [weighAnyway, setWeighAnyway] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([getTrip(tripId), getTripDocuments(tripId), getCrossCheck(tripId).catch(() => null)])
      .then(([t, d, c]) => {
        setTrip(t);
        setDocs(d);
        setCrossCheck(c);
        if (t.clientId) getClient(t.clientId).then(setClient).catch(() => setClient(null));
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [tripId]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!trip || !docs) return <Loading what="Loading documents" />;

  const loaded = !!trip.loadingCompletedAt;
  const unloaded = !!trip.deliveredAt;
  const isSupervisor = !!session && trip.loadingSupervisorId !== null && trip.loadingSupervisorId === session.userId;
  // Uploading is its own permission, attachable to any role on the Access control screen.
  const canUpload = can('document.upload') || isSupervisor;
  const canVerify = can('document.verify');

  const docsFor = (item: DocItem) => docs.filter((d) => item.kinds.includes(d.kind));
  const lrStarted = !!trip.lr;
  const slipIn = docs.some((d) => d.kind === 'LOADING_SLIP' && (d.status === 'PENDING' || d.status === 'VERIFIED'));
  const needsWeighment = !!client?.needsWeighmentSlip;
  const openLr = () => {
    setLrOpen(true);
    // Let the panel render, then bring it into view.
    setTimeout(() => document.getElementById('order-elr')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // Uploading is the file only. The details on it (numbers, dates, validity)
  // are typed by the verification team when they check it.
  const openUpload = (item: DocItem) => {
    setFile(null);
    setEditing(item);
  };

  const problem = editing && !file ? 'Choose the file to upload.' : null;

  const openCheck = (item: DocItem) => {
    const current = docsFor(item);
    const v: Record<string, string> = {};
    for (const f of item.fields) {
      const raw = valueOf(item, f, current);
      v[f.key] = f.type === 'rupees' && raw ? String(Number(raw) / 100) : raw;
    }
    setValues(v);
    setChecking(item);
  };

  const checkProblem = (() => {
    if (!checking) return null;
    const missing = checking.fields.find((f) => f.required && !String(values[f.key] ?? '').trim());
    return missing ? `Enter the ${missing.label.toLowerCase()} from the document.` : null;
  })();

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (!file) throw new Error('Choose the file to upload.');
      const attachmentId = await uploadAttachment(file, editing.kinds[0], 'trips', tripId);
      // One file, stored against every kind it stands for.
      for (const kind of editing.kinds) await uploadTripDocument(tripId, kind, { attachmentId });
      toast(`${editing.title} uploaded · the verification team checks it and enters its details`);
      setEditing(null);
      setFile(null);
      load();
      onChanged();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const item = checking;
    if (!item) return;
    setBusy(true);
    try {
      for (const d of docsFor(item).filter((x) => x.status === 'PENDING')) {
        // Each kind gets its own details — the vehicle papers PDF carries five.
        const keyed: Record<string, string> = {};
        for (const f of item.fields) {
          if ((f.kind ?? item.kinds[0]) !== d.kind) continue;
          const raw = String(values[f.key] ?? '').trim();
          if (!raw) continue;
          keyed[f.storeAs ?? f.key] =
            f.type === 'rupees' ? String(Math.round(Number(raw) * 100)) : f.key === 'vehicleNo' ? raw.toUpperCase() : raw;
        }
        await verifyTripDocument(tripId, d.kind, keyed);
      }
      setChecking(null);
      toast(`Verified · ${item.title}`);
      load();
      onChanged();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      for (const d of docsFor(rejecting).filter((x) => x.status === 'PENDING' || x.status === 'VERIFIED'))
        await rejectTripDocument(tripId, d.kind, reason.trim());
      toast(`Rejected · ${rejecting.title} · upload it again`);
      setRejecting(null);
      setReason('');
      load();
      onChanged();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
  };

  const card = (item: DocItem) => {
    const current = docsFor(item);
    if (current.length === 0) return null;
    const state = stateOf(current);
    const attachmentId = current.find((d) => d.attachmentId)?.attachmentId ?? null;
    const rejectedWhy = current.find((d) => d.rejectReason)?.rejectReason;
    const uploaded = state !== 'MISSING';
    // Not every client wants a weighment slip. For one that does not, the card
    // is closed as not needed — it can still be uploaded if one turns up.
    if (item.id === 'weighment' && !needsWeighment && !uploaded && !weighAnyway) {
      return (
        <div key={item.id} data-doc={item.id} className="doc-card doc-card-closed">
          <div className="doc-card-head">
            <strong>{item.title}</strong>
            <Tag tone="grey">Not needed</Tag>
          </div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            {client ? `${client.name} does not need a weighment slip.` : 'This client does not need a weighment slip.'} The
            client’s page sets this.
          </p>
          {canUpload && loaded && (
            <div className="doc-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setWeighAnyway(true)}>
                Upload one anyway
              </button>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={item.id} data-doc={item.id} className="doc-card">
        <DocPreview attachmentId={attachmentId} label={item.title} width={item.pdf ? 130 : 150} height={item.pdf ? 160 : 190} />
        <div style={{ minWidth: 0 }}>
          <div className="doc-card-head">
            <strong>{item.title}</strong>
            <Tag tone={STATE[state].tone}>{STATE[state].label}</Tag>
            {item.id === 'weighment' && needsWeighment && <Tag tone="blue">Needed by this client</Tag>}
          </div>
          <dl className="doc-facts">
            {item.fields.map((f) => (
              <div key={f.key} style={{ display: 'contents' }}>
                <dt>{f.label}</dt>
                <dd>{shown(f, valueOf(item, f, current))}</dd>
              </div>
            ))}
          </dl>
          {rejectedWhy && state === 'REJECTED' && (
            <div style={{ color: 'var(--red)', fontSize: 'var(--text-sm)', marginTop: 8 }}>Rejected: {rejectedWhy}</div>
          )}
          <div className="doc-actions">
            {canUpload && loaded && (
              <button className={uploaded ? 'btn btn-secondary btn-sm' : 'btn btn-sm'} disabled={busy} onClick={() => openUpload(item)}>
                {uploaded ? (state === 'REJECTED' ? 'Upload again' : 'Replace file') : `Upload ${item.pdf ? 'PDF' : 'photo'}`}
              </button>
            )}
            {canVerify && current.some((d) => d.status === 'PENDING') && (
              <>
                <button className="btn btn-sm" disabled={busy} onClick={() => openCheck(item)}>
                  Verify
                </button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRejecting(item)}>
                  Reject
                </button>
              </>
            )}
            {/* The loading slip stands in for the lorry receipt; an E-LR is generated from here if the client wants one. */}
            {item.id === 'loading-slip' && showLr && can('indent.manage') && (
              <button className="btn btn-secondary btn-sm" onClick={openLr}>
                {lrStarted ? `📄 Open the E-LR${trip.lr?.code ? ` · ${trip.lr.code}` : ''}` : '＋ Generate E-LR'}
              </button>
            )}
            {!loaded && !uploaded && (
              <span className="muted" style={{ fontSize: 12 }}>
                Uploaded once the truck is loaded.
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Stack>
      {!loaded && (
        <Banner
          tone="flag"
          title="The advance documents are uploaded once the truck is loaded"
          right={
            openTracking ? (
              <button className="btn btn-sm" onClick={openTracking}>
                Open Tracking
              </button>
            ) : undefined
          }
        >
          {openTracking
            ? 'Mark the truck as reached the loading point and then loaded on the Tracking tab. The upload buttons appear here after that.'
            : 'The loading supervisor marks loading complete on the trip page (or Operations marks it loaded on the order’s Tracking tab). The upload buttons appear here after that.'}
        </Banner>
      )}

      {crossCheck && crossCheck.mismatches.length > 0 && (
        <Banner
          tone="red"
          title={`${crossCheck.mismatches.length} cross-check mismatch${crossCheck.mismatches.length === 1 ? '' : 'es'}`}
          right={
            <button className="btn btn-secondary btn-sm" onClick={() => setOverrideOpen(true)}>
              Override and proceed
            </button>
          }
        >
          {crossCheck.mismatches.map((m) => `${m.field}: ${m.a.value || '—'} vs ${m.b.value || '—'}`).join(' · ')}. Fix the
          document, or override it with a reason — a role senior to Operations approves the override.
        </Banner>
      )}

      {SECTIONS.map((section) => {
        const cards = section.items.map(card).filter(Boolean);
        if (cards.length === 0) return null;
        return (
          <Panel key={section.title} title={section.title}>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              {section.note}
            </p>
            <Stack gap={12}>{cards}</Stack>
          </Panel>
        );
      })}

      {/* The E-LR — only when someone asked for one from the loading slip, or one was already started. */}
      {showLr && (lrOpen || lrStarted) && (
        <div id="order-elr">
          <Panel
            title="📄 E-LR (lorry receipt)"
            right={
              !lrStarted ? (
                <button className="btn btn-secondary btn-sm" onClick={() => setLrOpen(false)}>
                  Close
                </button>
              ) : undefined
            }
            pad={false}
          >
            <div style={{ padding: 15 }}>
              {slipIn && (
                <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
                  The loading slip is in, so a lorry receipt is optional — issue this only if the client wants one.
                </p>
              )}
              <LorryReceiptContent
                tripId={tripId}
                onLoaded={(d) => {
                  onLrLoaded?.(d.lr.code);
                }}
              />
            </div>
          </Panel>
        </div>
      )}

      {showPod && (
        <Panel title="📸 Proof of delivery">
          {unloaded ? (
            <PodVerifyContent tripId={tripId} showOrderLink={false} showStatusTag={false} />
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              The proof of delivery — an E-POD (photo or scan) or the H-POD (signed hard copy) — is uploaded here once the
              truck is marked unloaded on the Tracking tab.
            </p>
          )}
        </Panel>
      )}

      <Dialog
        open={overrideOpen}
        title="Override the cross-check"
        body="An override does not correct the document — it proceeds in spite of it. A role senior to Operations approves it, and it is kept on the audit trail."
        confirmLabel="Request override"
        confirmDisabled={overrideReason.trim().length < 20}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await overrideCrossCheck(tripId, overrideReason.trim());
            toast('Override requested');
          } catch (e) {
            toast(
              e instanceof ApprovalRequiredError
                ? 'Sent for approval · the mismatch stays open until it is approved'
                : errorMessage(e),
            );
          } finally {
            setBusy(false);
            setOverrideOpen(false);
            setOverrideReason('');
          }
        }}
        onClose={() => setOverrideOpen(false)}
      >
        <Field label="Reason" required hint="At least 20 characters.">
          <textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={!!editing}
        title={editing ? editing.title : ''}
        body={
          editing?.pdf
            ? 'Upload the PDF with the vehicle papers. The verification team checks it and enters the numbers and dates.'
            : 'Upload the photo or scan. The verification team checks it and enters the details written on it.'
        }
        confirmLabel="Upload"
        confirmDisabled={!!problem}
        busy={busy}
        onConfirm={save}
        onClose={() => setEditing(null)}
      >
        <input
          ref={fileRef}
          type="file"
          accept={editing?.pdf ? 'application/pdf,image/*' : 'image/*,application/pdf'}
          aria-label={editing?.pdf ? 'Vehicle papers PDF' : 'Document photo'}
          onChange={onFile}
        />
        {problem && (
          <div className="hint" role="status">
            {problem}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!checking}
        title={checking ? `Verify · ${checking.title}` : ''}
        body="Check the document, then type its details from it. They are saved with the verification."
        confirmLabel="Verify"
        confirmDisabled={!!checkProblem}
        busy={busy}
        onConfirm={verify}
        onClose={() => setChecking(null)}
      >
        {checking && (
          <div className="doc-check">
            <DocPreview
              attachmentId={docsFor(checking).find((d) => d.attachmentId)?.attachmentId ?? null}
              label={checking.title}
              width={checking.pdf ? 150 : 170}
              height={checking.pdf ? 190 : 210}
            />
            <FormGrid>
              {checking.fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <input
                    type={f.type === 'date' ? 'date' : f.type === 'rupees' || f.type === 'number' ? 'number' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </Field>
              ))}
            </FormGrid>
          </div>
        )}
        {checkProblem && (
          <div className="hint" role="status">
            {checkProblem}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!rejecting}
        title={`Reject ${rejecting?.title ?? ''}`}
        body="It goes back to be uploaded again. The reason is kept on record."
        confirmLabel="Reject"
        confirmDisabled={!reason.trim()}
        busy={busy}
        onConfirm={reject}
        onClose={() => setRejecting(null)}
      >
        <Field label="Reason" required>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </Stack>
  );
}

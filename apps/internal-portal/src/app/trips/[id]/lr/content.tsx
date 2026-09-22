'use client';

import Link from 'next/link';
import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, request } from '@/apis';
import { fmtDateTime, inr } from '@/lib/format';
import {
  Banner,
  Dialog,
  Field,
  FormGrid,
  Loading,
  ErrorState,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import {
  generateLr,
  getCrossCheck,
  getLr,
  getTrip,
  patchLr,
  rejectTripDocument,
  shareLr,
  uploadTripDocument,
  verifyTripDocument,
} from '../../apis';
import { CrossCheckResult, LorryReceipt, TripDetail, TripDocument } from '../../types';

const LR_DOC_TONE: Record<TripDocument['status'], Tone> = {
  MISSING: 'grey',
  PENDING: 'flag',
  VERIFIED: 'mint',
  REJECTED: 'red',
};

const EMPTY: LorryReceipt = {
  code: null,
  status: 'DRAFT',
  lrDate: null,
  bookedAt: null,
  sharedAt: null,
  consignor: { name: '', address: '', gstin: '' },
  consignee: { name: '', address: '', gstin: '' },
  goods: { description: '', packages: 0, weightTn: 0, valuePaise: 0 },
  invoice: { number: '', datedOn: '', valuePaise: 0 },
  eway: { number: '', validTill: '' },
  vehicle: { registration: '', type: '' },
  driver: { name: '', licence: '', phone: '' },
  transitDays: 0,
  remarks: '',
  chargeHeads: { freightPaise: 0, loadingPaise: 0, unloadingPaise: 0, detentionPaise: 0, otherPaise: 0, discountPaise: 0 },
};

/**
 * The whole of `/trips/[id]/lr`, minus its own `PageHeader`/`PageIntro`/
 * `TripTabs` — extracted (part 04, the "everything about one order, one
 * screen, no redirects" rebuild) so the order detail page's Documents tab
 * can embed this exact fill-in/autosave/generate/share workflow. The route
 * itself (`page.tsx`) still renders this unchanged.
 *
 * `onLoaded` mirrors the trip+LR pair up to a wrapping page's own header
 * (title, Print/Share/Generate) without a second fetch — the same pattern
 * `PodVerifyContent` uses. `showActions` hides the Print/Share/Generate
 * buttons from the embedded copy when the wrapping page already renders
 * them in its own header (the standalone route does; the order page's tab
 * body doesn't have a header slot to put them in, so it keeps them here).
 */
export function LorryReceiptContent({
  tripId,
  onLoaded,
}: {
  tripId: string;
  onLoaded?: (data: { trip: TripDetail; lr: LorryReceipt }) => void;
}) {
  const can = useCan();
  const toast = useToast();

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [lr, setLr] = useState<LorryReceipt | null>(null);
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which of the two ways to get this trip a lorry receipt has been picked —
  // a real E-LR generated in this system, or a physical/transporter-supplied
  // one attached as a document. Local only until one actually has data
  // behind it (`lr.code`, or the trip's own `LR`-kind document); before
  // that, either choice is still reversible.
  const [choosing, setChoosing] = useState<'MANUAL' | 'DIGITAL' | null>(null);
  const manualFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingManual, setUploadingManual] = useState(false);
  const [rejectingManual, setRejectingManual] = useState(false);
  const [manualRejectReason, setManualRejectReason] = useState('');

  const load = useCallback(() => {
    setError(null);
    Promise.all([getTrip(tripId), getLr(tripId), getCrossCheck(tripId)])
      .then(([t, l, c]) => {
        setTrip(t);
        const lrValue = l ?? {
          ...EMPTY,
          vehicle: { registration: t.vehicleNo, type: t.vehicleType },
          transitDays: t.transitDaysRequired,
          remarks: t.remarks,
        };
        setLr(lrValue);
        setCrossCheck(c);
        onLoaded?.({ trip: t, lr: lrValue });
      })
      .catch((e) => setError(errorMessage(e)));
    // `onLoaded` is a fresh function identity on every parent render (it
    // closes over `setPod`/`setLr`-style state setters inline) — including
    // it here would refetch on every render instead of only when the trip
    // changes, so it's deliberately left out of the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const edit = (patch: Partial<LorryReceipt>) => {
    setLr((prev) => {
      const next = { ...(prev ?? EMPTY), ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        patchLr(tripId, next)
          .then(() => setSavedAt(new Date().toISOString()))
          .catch(() => undefined);
      }, 3000);
      return next;
    });
  };

  const generate = async () => {
    setBusy(true);
    try {
      const issued = await generateLr(tripId);
      setLr(issued);
      toast(`${issued.code} issued · the trip is open`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    try {
      const shared = await shareLr(tripId);
      setLr(shared);
      toast('Shared with the transporter — sharing is never a required step');
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const pickManualFile = () => manualFileInputRef.current?.click();

  const onManualFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingManual(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'LR');
      formData.append('entityType', 'trip');
      formData.append('entityId', tripId);
      const { id: attachmentId } = await request<{ id: string }>({
        url: '/attachments',
        method: 'POST',
        data: formData,
      });
      await uploadTripDocument(tripId, 'LR', { attachmentId });
      toast('Lorry receipt uploaded · sent for verification');
      load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setUploadingManual(false);
    }
  };

  const verifyManual = async () => {
    try {
      await verifyTripDocument(tripId, 'LR');
      toast('Lorry receipt verified');
      load();
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const rejectManual = async () => {
    setBusy(true);
    try {
      await rejectTripDocument(tripId, 'LR', manualRejectReason);
      toast('Rejected · a fresh copy is needed');
      setRejectingManual(false);
      setManualRejectReason('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!trip || !lr) return <Loading what="Loading the lorry receipt" />;

  const mismatchOpen = !!crossCheck && crossCheck.mismatches.length > 0 && !crossCheck.overridden;
  const notPlaced = !trip.vehicleNo;
  const canIssue = can('indent.manage') && !lr.code && !mismatchOpen && !notPlaced;

  const lrDoc = trip.documents.find((d) => d.kind === 'LR') ?? null;
  const hasManualUpload = !!lrDoc && lrDoc.status !== 'MISSING';
  const hasGenerated = !!lr.code;
  // Real data always wins over whatever was clicked a moment ago — the
  // choice is only still open while neither path has anything behind it.
  const path = hasGenerated ? 'DIGITAL' : hasManualUpload ? 'MANUAL' : choosing;

  // Neither path has anything behind it yet — one lorry receipt, one way to
  // get it, chosen once. Showing the full generate form and an upload slot
  // side by side invited both at once, which is exactly the confusion this
  // screen exists to remove.
  if (path === null) {
    return (
      <Panel title="How is this trip's lorry receipt coming?">
        <p className="hint" style={{ marginTop: 0 }}>
          Pick one. A transporter who already carries their own LR can have it uploaded here instead of a fresh one
          being generated — either way, this becomes the trip's lorry receipt.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
          <button
            className="btn btn-lg"
            onClick={() => setChoosing('DIGITAL')}
            disabled={notPlaced}
            style={{ flex: '1 1 220px' }}
          >
            🧾 Generate an E-LR
          </button>
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => setChoosing('MANUAL')}
            disabled={!can('indent.manage') && !can('document.verify')}
            style={{ flex: '1 1 220px' }}
          >
            📎 Upload one manually
          </button>
        </div>
        {notPlaced && (
          <Banner tone="red" title="The truck is not placed">
            A lorry receipt — generated or uploaded — needs the placed vehicle recorded on the indent first.
          </Banner>
        )}
      </Panel>
    );
  }

  if (path === 'MANUAL') {
    return (
      <>
        <Panel
          title="Lorry receipt — uploaded manually"
          right={lrDoc && lrDoc.status !== 'MISSING' && <Tag tone={LR_DOC_TONE[lrDoc.status]}>{lrDoc.status}</Tag>}
        >
          <input
            ref={manualFileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={onManualFileChosen}
            style={{ display: 'none' }}
          />
          {!hasManualUpload ? (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Attach the transporter's own lorry receipt as a photo or PDF. It goes to compliance for verification
                the same way any other trip document does.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={pickManualFile} disabled={uploadingManual}>
                  {uploadingManual ? 'Uploading…' : 'Choose file'}
                </button>
                <button className="btn btn-ghost" onClick={() => setChoosing(null)}>
                  ← Choose a different way instead
                </button>
              </div>
            </>
          ) : (
            <>
              <FactRow label="Uploaded" value={lrDoc?.uploadedAt ? fmtDateTime(lrDoc.uploadedAt) : '—'} />
              {lrDoc?.status === 'VERIFIED' && (
                <FactRow
                  label="Verified"
                  value={`${lrDoc.verifiedBy ?? 'Compliance'} · ${lrDoc.verifiedAt ? fmtDateTime(lrDoc.verifiedAt) : ''}`}
                />
              )}
              {lrDoc?.status === 'REJECTED' && (
                <Banner tone="red" title="Rejected">
                  {lrDoc.rejectReason}
                </Banner>
              )}
              {(lrDoc?.status === 'MISSING' || lrDoc?.status === 'REJECTED') && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-secondary btn-sm" onClick={pickManualFile} disabled={uploadingManual}>
                    {uploadingManual ? 'Uploading…' : 'Upload again'}
                  </button>
                </div>
              )}
              {lrDoc?.status === 'PENDING' && can('document.verify') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setRejectingManual(true)}>
                    Reject
                  </button>
                  <button className="btn btn-sm" onClick={verifyManual}>
                    Verify
                  </button>
                </div>
              )}
              {lrDoc?.status === 'VERIFIED' && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-secondary btn-sm" onClick={pickManualFile} disabled={uploadingManual}>
                    {uploadingManual ? 'Uploading…' : 'Replace'}
                  </button>
                </div>
              )}
            </>
          )}
        </Panel>

        <Dialog
          open={rejectingManual}
          title="Reject this lorry receipt"
          body="The transporter is asked for a clearer or correct copy. The rejection and its reason are written to the audit trail."
          confirmLabel="Reject and request re-upload"
          confirmDisabled={!manualRejectReason.trim()}
          busy={busy}
          onConfirm={rejectManual}
          onClose={() => setRejectingManual(false)}
        >
          <Field label="Reason" required>
            <textarea rows={3} value={manualRejectReason} onChange={(e) => setManualRejectReason(e.target.value)} />
          </Field>
        </Dialog>
      </>
    );
  }

  return (
    <Stack>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {!lr.code && (
          <button className="btn btn-ghost btn-sm" onClick={() => setChoosing(null)}>
            ← Choose a different way instead
          </button>
        )}
        {lr.code && (
          <Link href={`/print/lr/${tripId}`} className="btn btn-secondary">
            Print
          </Link>
        )}
        {lr.code && !lr.sharedAt && (
          <button className="btn btn-secondary" onClick={share}>
            Share with transporter
          </button>
        )}
        {!lr.code && (
          <button className="btn" onClick={generate} disabled={!canIssue || busy}>
            Generate LR
          </button>
        )}
      </div>

      {notPlaced && (
        <Banner tone="red" title="The truck is not placed">
          A lorry receipt cannot be issued before placement. Record the placed vehicle on the indent first.
        </Banner>
      )}
      {mismatchOpen && (
        <Banner tone="red" title="A cross-check mismatch is open">
          Generation stays blocked until the mismatch is rejected or overridden — the penalty happens at a
          checkpost, and by then it's too late.
        </Banner>
      )}
      {lr.sharedAt && (
        <Banner tone="mint" title="Shared">
          Sent to the transporter at {fmtDateTime(lr.sharedAt)}. Sharing was optional and remains so.
        </Banner>
      )}
      {savedAt && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          Draft saved {fmtDateTime(savedAt)}
        </div>
      )}

      <Panel title="Consignor">
        <FormGrid>
          <Field label="Name">
            <input
              value={lr.consignor.name}
              disabled={!!lr.code}
              onChange={(e) => edit({ consignor: { ...lr.consignor, name: e.target.value } })}
            />
          </Field>
          <Field label="Address">
            <input
              value={lr.consignor.address}
              disabled={!!lr.code}
              onChange={(e) => edit({ consignor: { ...lr.consignor, address: e.target.value } })}
            />
          </Field>
          <Field label="GSTIN">
            <input
              value={lr.consignor.gstin}
              disabled={!!lr.code}
              onChange={(e) => edit({ consignor: { ...lr.consignor, gstin: e.target.value } })}
            />
          </Field>
        </FormGrid>
      </Panel>

      <Panel title="Consignee">
        <FormGrid>
          <Field label="Name">
            <input
              value={lr.consignee.name}
              disabled={!!lr.code}
              onChange={(e) => edit({ consignee: { ...lr.consignee, name: e.target.value } })}
            />
          </Field>
          <Field label="Address">
            <input
              value={lr.consignee.address}
              disabled={!!lr.code}
              onChange={(e) => edit({ consignee: { ...lr.consignee, address: e.target.value } })}
            />
          </Field>
          <Field label="GSTIN">
            <input
              value={lr.consignee.gstin}
              disabled={!!lr.code}
              onChange={(e) => edit({ consignee: { ...lr.consignee, gstin: e.target.value } })}
            />
          </Field>
        </FormGrid>
      </Panel>

      <Panel title="Goods, invoice and e-way bill">
        <FormGrid>
          <Field label="Goods description">
            <input
              value={lr.goods.description}
              disabled={!!lr.code}
              onChange={(e) => edit({ goods: { ...lr.goods, description: e.target.value } })}
            />
          </Field>
          <Field label="Packages">
            <input
              type="number"
              value={lr.goods.packages}
              disabled={!!lr.code}
              onChange={(e) => edit({ goods: { ...lr.goods, packages: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Weight (MT)">
            <input
              type="number"
              value={lr.goods.weightTn}
              disabled={!!lr.code}
              onChange={(e) => edit({ goods: { ...lr.goods, weightTn: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Client invoice number">
            <input
              value={lr.invoice.number}
              disabled={!!lr.code}
              onChange={(e) => edit({ invoice: { ...lr.invoice, number: e.target.value } })}
            />
          </Field>
          <Field label="Invoice value (₹)">
            <input
              type="number"
              value={lr.invoice.valuePaise / 100}
              disabled={!!lr.code}
              onChange={(e) => edit({ invoice: { ...lr.invoice, valuePaise: Number(e.target.value) * 100 } })}
            />
          </Field>
          <Field label="E-way bill number">
            <input
              value={lr.eway.number}
              disabled={!!lr.code}
              onChange={(e) => edit({ eway: { ...lr.eway, number: e.target.value } })}
            />
          </Field>
          <Field label="E-way valid till">
            <input
              type="datetime-local"
              value={lr.eway.validTill?.slice(0, 16) ?? ''}
              disabled={!!lr.code}
              onChange={(e) => edit({ eway: { ...lr.eway, validTill: e.target.value } })}
            />
          </Field>
        </FormGrid>
      </Panel>

      <Panel title="Vehicle, driver, transit">
        <FormGrid>
          <Field label="Registration">
            <input value={lr.vehicle.registration} disabled />
          </Field>
          <Field label="Vehicle type">
            <input value={lr.vehicle.type} disabled />
          </Field>
          <Field label="Driver">
            <input
              value={lr.driver.name}
              disabled={!!lr.code}
              onChange={(e) => edit({ driver: { ...lr.driver, name: e.target.value } })}
            />
          </Field>
          <Field label="Licence">
            <input
              value={lr.driver.licence}
              disabled={!!lr.code}
              onChange={(e) => edit({ driver: { ...lr.driver, licence: e.target.value } })}
            />
          </Field>
          <Field label="Transit days" hint="Carried from the indent.">
            <input type="number" value={lr.transitDays} disabled />
          </Field>
          <Field label="Remarks" hint="Carried from the indent.">
            <input value={lr.remarks} disabled={!!lr.code} onChange={(e) => edit({ remarks: e.target.value })} />
          </Field>
        </FormGrid>
      </Panel>

      <Panel title="Charge heads">
        <FormGrid>
          {(
            [
              ['freightPaise', 'Freight'],
              ['loadingPaise', 'Loading'],
              ['unloadingPaise', 'Unloading'],
              ['detentionPaise', 'Detention'],
              ['otherPaise', 'Other'],
              ['discountPaise', 'Discount'],
            ] as [keyof LorryReceipt['chargeHeads'], string][]
          ).map(([key, label]) => (
            <Field key={key} label={`${label} (₹)`}>
              <input
                type="number"
                value={lr.chargeHeads[key] / 100}
                disabled={!!lr.code}
                onChange={(e) => edit({ chargeHeads: { ...lr.chargeHeads, [key]: Number(e.target.value) * 100 } })}
              />
            </Field>
          ))}
        </FormGrid>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Tag tone="grey">Total</Tag>
          <span className="mono">
            {inr(Object.values(lr.chargeHeads).reduce((a, b) => a + b, 0) - 2 * lr.chargeHeads.discountPaise)}
          </span>
        </div>
      </Panel>
    </Stack>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

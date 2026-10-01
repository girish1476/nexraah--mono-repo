'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ApiError, errorMessage } from '@/apis';
import { CHARGE_TYPES, POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { fmtDate, inr } from '@/lib/format';
import { sessionAtom } from '@/store/atoms';
import {
  Banner,
  Dialog,
  ErrorState,
  FactList,
  Field,
  FormGrid,
  Loading,
  Panel,
  Split,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { approvePod, getPod, logHardCopy, receivePod, rejectPod, uploadEpod, verifyPod } from '../../apis';
import { POD_KIND_LABEL, PodDetail, PodKind, VerifyChecklist } from '../../types';
import { DocPreview } from '@/components/doc-preview';
import { uploadAttachment } from '@/lib/attachments';
import { listSdr } from '@/app/sdr/apis';
import { SDR_KIND_LABEL, SdrKind, SdrRecord } from '@/app/sdr/types';

const CHECKS: { key: keyof VerifyChecklist; label: string }[] = [
  { key: 'consigneeStamp', label: 'Consignee stamp present' },
  { key: 'signedAndDated', label: 'Signed and dated' },
  { key: 'lrNumberMatches', label: 'LR number matches' },
  { key: 'quantityMatchesInvoice', label: 'Quantity matches the invoice' },
  { key: 'noShortageOrDamage', label: 'No shortage or damage noted' },
];

interface ChargeDraft {
  chargeType: string;
  costRupees: number;
  billedRupees: number;
}

/**
 * The whole of `/pod/[id]/verify`, minus its own `PageHeader`/`PageIntro` —
 * extracted (part 04, the "everything about one order, one screen, no
 * redirects" rebuild) so the order detail page's Delivery proof tab can
 * embed this exact verify/approve/reject workflow. The route itself
 * (`page.tsx`) still renders this unchanged.
 *
 * `showOrderLink` hides the header's own "View order" button — dead weight
 * when this is already embedded on the order page.
 */
export function PodVerifyContent({
  tripId,
  showOrderLink = true,
  showStatusTag = true,
  onLoaded,
}: {
  tripId: string;
  showOrderLink?: boolean;
  /** The order page shows its own status pill in its own header — no need
   *  for this content to repeat it there. */
  showStatusTag?: boolean;
  /** Lets a wrapping page (the standalone `/pod/[id]/verify` route) mirror
   *  this data into its own `PageHeader` without fetching it a second time. */
  onLoaded?: (pod: PodDetail) => void;
}) {
  const can = useCan();
  const toast = useToast();
  const session = useAtomValue(sessionAtom);

  const [pod, setPod] = useState<PodDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<VerifyChecklist>({
    consigneeStamp: true,
    signedAndDated: true,
    lrNumberMatches: true,
    quantityMatchesInvoice: true,
    noShortageOrDamage: true,
  });
  const [remarks, setRemarks] = useState('');
  const [charges, setCharges] = useState<ChargeDraft[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [sdrKind, setSdrKind] = useState<SdrKind>('DAMAGE');
  const [sdrClaimedRupees, setSdrClaimedRupees] = useState(0);
  const [sdrs, setSdrs] = useState<SdrRecord[]>([]);
  // E-POD (a photo or scan uploaded now) or H-POD (the hard copy by courier).
  const [podMode, setPodMode] = useState<PodKind>('EPOD');
  const [epodFiles, setEpodFiles] = useState<File[]>([]);
  const [receive, setReceive] = useState({
    courierDocket: '',
    sentOn: '',
    receivedOn: new Date().toISOString().slice(0, 10),
    pages: 1,
    condition: '',
  });

  const load = () => {
    setError(null);
    getPod(tripId)
      .then((d) => {
        setPod(d);
        onLoaded?.(d);
      })
      .catch((e) => setError(errorMessage(e)));
    listSdr({ trip: tripId })
      .then(setSdrs)
      .catch(() => setSdrs([]));
  };
  useEffect(load, [tripId]);

  const anyFailed = Object.values(checklist).some((v) => !v);
  // Same rule as the server's `sdrKindFromChecklist`.
  const raisesSdr = !checklist.noShortageOrDamage || !checklist.quantityMatchesInvoice;
  useEffect(() => {
    setSdrKind(!checklist.quantityMatchesInvoice && checklist.noShortageOrDamage ? 'SHORTAGE' : 'DAMAGE');
  }, [checklist.quantityMatchesInvoice, checklist.noShortageOrDamage]);

  // The courier slip photo — on the H-POD form, and on the hard-copy follow-up after an E-POD.
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [hardCopy, setHardCopy] = useState({ courierDocket: '', sentOn: '', receivedOn: '' });

  const submitHardCopy = async (values: { courierDocket: string; sentOn: string; receivedOn: string }) => {
    setBusy(true);
    try {
      const courierSlipAttachmentId = slipFile ? await uploadAttachment(slipFile, 'COURIER_SLIP', 'trips', tripId) : undefined;
      const saved = await logHardCopy(tripId, {
        courierDocket: values.courierDocket.trim(),
        sentOn: values.sentOn,
        ...(values.receivedOn ? { receivedOn: values.receivedOn } : {}),
        ...(courierSlipAttachmentId ? { courierSlipAttachmentId } : {}),
      });
      setHardCopy({ courierDocket: '', sentOn: '', receivedOn: '' });
      toast(saved.receivedOn ? 'Hard copy received at HO · follow-up closed' : 'Hard copy on its way · docket saved — mark it received when it reaches HO');
      setSlipFile(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReceive = async () => {
    setBusy(true);
    try {
      const courierSlipAttachmentId = slipFile ? await uploadAttachment(slipFile, 'COURIER_SLIP', 'trips', tripId) : undefined;
      const receipt = await receivePod(tripId, {
        courierDocket: receive.courierDocket.trim(),
        sentOn: receive.sentOn,
        receivedOn: receive.receivedOn,
        pages: receive.pages,
        condition: receive.condition.trim() || undefined,
        ...(courierSlipAttachmentId ? { courierSlipAttachmentId } : {}),
      });
      setSlipFile(null);
      toast(`${receipt.code} logged · the clock has stopped — it can be verified now`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitEpod = async () => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of epodFiles) ids.push(await uploadAttachment(f, 'POD', 'trips', tripId));
      const receipt = await uploadEpod(tripId, ids);
      toast(`${receipt.code} · E-POD uploaded · the clock has stopped — it can be verified now`);
      setEpodFiles([]);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async () => {
    setBusy(true);
    try {
      const result = await verifyPod(tripId, {
        checklist,
        remarks: remarks || undefined,
        ...(raisesSdr ? { sdrKind, sdrClaimedAmountPaise: Math.round(sdrClaimedRupees * 100) } : {}),
        charges: charges.map((c) => ({
          chargeType: c.chargeType,
          costAmountPaise: Math.round(c.costRupees * 100),
          billedAmountPaise: Math.round(c.billedRupees * 100),
        })),
      });
      toast(
        result.sdrCode
          ? `Verified · ${result.sdrCode} raised from the remarks — the balance is held until it is resolved.`
          : 'Verified · a second person needs to approve it before the balance is released.',
      );
      setCharges([]);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitApprove = async () => {
    setBusy(true);
    try {
      await approvePod(tripId);
      toast('Approved · the balance is unblocked. Finance still releases it.');
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'APPROVER_IS_VERIFIER') toast(e.message);
      else toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async () => {
    setBusy(true);
    try {
      await rejectPod(tripId, rejectReason);
      toast('Rejected · sent back to the transporter, and the penalty clock keeps running.');
      setRejectOpen(false);
      setRejectReason('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!pod) return <Loading what="Loading the proof of delivery" />;

  const isVerifier = !!pod.verifiedBy && pod.verifiedBy === session?.userId;
  const canVerify = can('pod.verify') && pod.podStatus === 'RECEIVED';
  const canApprove = can('pod.approve') && pod.podStatus === 'VERIFIED' && !isVerifier;

  return (
    <>
      {(showOrderLink || showStatusTag) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {showOrderLink && (
            <Link href={`/orders/${pod.indentCode}`} className="btn btn-secondary">
              View order
            </Link>
          )}
          {showStatusTag && (
            <Tag tone={POD_TONE[pod.podStatus] as Tone}>{POD_STATUS_LABEL[pod.podStatus] ?? pod.podStatus}</Tag>
          )}
        </div>
      )}
      <Split
        aside={
          <>
            <Panel title="This proof" pad={false}>
              <FactList
                facts={[
                  ['Trip', <Link key="t" href={`/trips/${pod.tripId}`}>{pod.tripCode}</Link>],
                  ['LR', pod.lrCode ?? '—'],
                  ['Client', pod.clientName],
                  ['Transporter', pod.vendorName],
                  ['Delivered', fmtDate(pod.deliveredAt)],
                  ['Day', pod.ageDays],
                  ['Late-proof penalty', inr(pod.penaltyPaise)],
                  [
                    'Transit penalty',
                    (pod.transitPenaltyPaise ?? 0) > 0
                      ? `${inr(pod.transitPenaltyPaise ?? 0)}${
                          pod.actualTransitDays != null && pod.transitDaysRequired != null
                            ? ` · ${pod.actualTransitDays} days against ${pod.transitDaysRequired}`
                            : ''
                        }`
                      : 'None — delivered on time',
                  ],
                  ['Pages', pod.pages],
                ]}
              />
            </Panel>
            {pod.hardCopy?.courierSlipAttachmentId && (
              <Panel title="Courier slip">
                <DocPreview attachmentId={pod.hardCopy.courierSlipAttachmentId} label="Courier slip of the hard copy" width={140} height={170} />
              </Panel>
            )}
            {pod.receipt && (
              <Panel title="Receiving record" pad={false}>
                <FactList
                  facts={[
                    ['Receipt', pod.receipt.code],
                    ['Came in as', pod.receipt.podKind ? POD_KIND_LABEL[pod.receipt.podKind] : POD_KIND_LABEL.HPOD],
                    ['Courier docket', pod.receipt.courierDocket ?? '—'],
                    ['Sent on', fmtDate(pod.receipt.sentOn)],
                    ['Received on', fmtDate(pod.receipt.receivedOn)],
                    ['Received by', pod.receipt.receivedBy],
                    ['Condition', pod.receipt.condition ?? '—'],
                  ]}
                />
              </Panel>
            )}
          </>
        }
      >
        <Panel
          title="Document"
          right={pod.podKind ? <Tag tone="blue">{POD_KIND_LABEL[pod.podKind]}</Tag> : undefined}
        >
          {pod.podStatus === 'PENDING' ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              Nothing has come in yet. Upload the E-POD, or log the H-POD when the hard copy arrives.
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                {pod.attachmentIds.map((attachmentId, i) => (
                  <DocPreview key={attachmentId} attachmentId={attachmentId} label={`Proof of delivery, page ${i + 1}`} />
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
                Click a page to open it full size. Pages are served on short-lived signed links.
              </p>
            </>
          )}
        </Panel>

        {pod.podStatus === 'PENDING' || pod.podStatus === 'ATTACHED' ? (
          <Panel title="Receive the proof of delivery">
            <div className="stage-tabs" role="tablist" style={{ marginBottom: 12 }}>
              {(['EPOD', 'HPOD'] as PodKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={podMode === k}
                  className={podMode === k ? 'stage-tab is-active' : 'stage-tab'}
                  onClick={() => setPodMode(k)}
                >
                  <span className="glyph" aria-hidden>
                    {k === 'EPOD' ? '📱' : '📄'}
                  </span>
                  {k === 'EPOD' ? 'E-POD' : 'H-POD'}
                </button>
              ))}
            </div>
            {podMode === 'EPOD' ? (
              <>
                <Banner tone="blue" title="E-POD — upload the photo or scan of the signed delivery note">
                  It stops the clock and can be checked straight away. If the hard copy follows by courier, it can still
                  be logged later.
                </Banner>
                {can('pod.receive') ? (
                  <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                    <Field label="Photo or scan" hint="One or more pages — photos or a PDF.">
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf"
                        aria-label="E-POD photo or scan"
                        onChange={(e) => setEpodFiles(Array.from(e.target.files ?? []))}
                      />
                    </Field>
                    <button className="btn" disabled={busy || epodFiles.length === 0} onClick={submitEpod}>
                      Upload E-POD — stop the clock
                    </button>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                    Operations or the branch uploads the E-POD.
                  </p>
                )}
              </>
            ) : (
              <>
            <Banner tone="flag" title="H-POD — the signed hard copy has not been logged">
              {pod.podStatus === 'ATTACHED'
                ? 'The transporter has sent a photo. Log the paper copy when it reaches the branch — that is what stops the clock.'
                : 'Waiting for the hard copy by courier. Log it when it reaches the branch — that is what stops the clock and lets it be verified.'}
            </Banner>
            {can('pod.receive') ? (
              <div style={{ marginTop: 12 }}>
                <FormGrid>
                  <Field label="Courier docket" required>
                    <input value={receive.courierDocket} onChange={(e) => setReceive({ ...receive, courierDocket: e.target.value })} />
                  </Field>
                  <Field label="Sent on" required>
                    <input type="date" value={receive.sentOn} onChange={(e) => setReceive({ ...receive, sentOn: e.target.value })} />
                  </Field>
                  <Field label="Received on" required>
                    <input type="date" value={receive.receivedOn} onChange={(e) => setReceive({ ...receive, receivedOn: e.target.value })} />
                  </Field>
                  <Field label="Pages" required>
                    <input
                      type="number"
                      min={1}
                      value={receive.pages}
                      onChange={(e) => setReceive({ ...receive, pages: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </Field>
                  <Field label="Condition" hint="Optional — e.g. torn, water-damaged">
                    <input value={receive.condition} onChange={(e) => setReceive({ ...receive, condition: e.target.value })} />
                  </Field>
                  <Field label="Courier slip photo" hint="Optional — the slip the hard copy came with.">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      aria-label="Courier slip photo"
                      onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)}
                    />
                  </Field>
                </FormGrid>
                <button
                  className="btn"
                  style={{ marginTop: 12 }}
                  disabled={busy || !receive.courierDocket.trim() || !receive.sentOn || !receive.receivedOn}
                  onClick={submitReceive}
                >
                  Log the paper copy — stop the clock
                </button>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                The branch receiving desk logs the paper copy.
              </p>
            )}
              </>
            )}
          </Panel>
        ) : null}

        {/* The soft copy is in; follow up until the signed hard copy reaches HO. */}
        {pod.podKind === 'EPOD' && pod.podStatus !== 'FORFEITED' && (
          <Panel
            title="📮 Hard copy follow-up"
            right={
              pod.hardCopy?.receivedOn ? (
                <Tag tone="mint">Received at HO</Tag>
              ) : pod.hardCopy?.courierDocket ? (
                <Tag tone="blue">On its way</Tag>
              ) : (
                <Tag tone="flag">Waiting for the hard copy</Tag>
              )
            }
          >
            {pod.hardCopy?.receivedOn ? (
              <FactList
                facts={[
                  ['Courier docket', pod.hardCopy.courierDocket ?? '—'],
                  ['Sent on', fmtDate(pod.hardCopy.sentOn)],
                  ['Received at HO', fmtDate(pod.hardCopy.receivedOn)],
                ]}
              />
            ) : (
              <>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                  The soft copy (E-POD) is in. Follow up with the transporter until the signed hard copy reaches head
                  office, and upload its courier slip.
                </p>
                {can('pod.receive') ? (
                  <>
                    <FormGrid>
                      <Field label="Hard copy courier docket" required>
                        <input
                          value={hardCopy.courierDocket || pod.hardCopy?.courierDocket || ''}
                          onChange={(e) => setHardCopy({ ...hardCopy, courierDocket: e.target.value })}
                        />
                      </Field>
                      <Field label="Hard copy sent on" required>
                        <input
                          type="date"
                          value={hardCopy.sentOn || pod.hardCopy?.sentOn || ''}
                          onChange={(e) => setHardCopy({ ...hardCopy, sentOn: e.target.value })}
                        />
                      </Field>
                      <Field label="Received at HO on" hint="Leave empty while it is still on its way.">
                        <input type="date" value={hardCopy.receivedOn} onChange={(e) => setHardCopy({ ...hardCopy, receivedOn: e.target.value })} />
                      </Field>
                      <Field label="Courier slip photo">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          aria-label="Hard copy courier slip photo"
                          onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)}
                        />
                      </Field>
                    </FormGrid>
                    <button
                      className="btn"
                      style={{ marginTop: 12 }}
                      disabled={
                        busy ||
                        !(hardCopy.courierDocket || pod.hardCopy?.courierDocket || '').trim() ||
                        !(hardCopy.sentOn || pod.hardCopy?.sentOn)
                      }
                      onClick={() =>
                        submitHardCopy({
                          courierDocket: hardCopy.courierDocket || pod.hardCopy?.courierDocket || '',
                          sentOn: hardCopy.sentOn || pod.hardCopy?.sentOn || '',
                          receivedOn: hardCopy.receivedOn,
                        })
                      }
                    >
                      {hardCopy.receivedOn ? 'Mark the hard copy received at HO' : 'Save the hard copy’s courier details'}
                    </button>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                    Operations follows up the hard copy.
                  </p>
                )}
              </>
            )}
          </Panel>
        )}

        {canVerify && (
          <Panel title="Verify">
            {(pod.transitPenaltyPaise ?? 0) > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Banner tone="flag" title={`Transit penalty ${inr(pod.transitPenaltyPaise ?? 0)}`}>
                  Delivered late by the lane’s terms
                  {pod.actualTransitDays != null && pod.transitDaysRequired != null
                    ? ` — ${pod.actualTransitDays} days against ${pod.transitDaysRequired}`
                    : ''}
                  . It comes off the final payment with any shortage or damage.
                </Banner>
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {CHECKS.map((c) => (
                <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={checklist[c.key]}
                    onChange={(e) => setChecklist({ ...checklist, [c.key]: e.target.checked })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <Field
                label="Remarks"
                required={anyFailed}
                error={anyFailed && !remarks.trim() ? 'Remarks are mandatory when any check fails' : undefined}
              >
                <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </div>

            {raisesSdr && (
              <div style={{ marginTop: 12 }}>
                <Banner tone="flag" title="These remarks will be recorded as a shortage / damage record (SDR)">
                  The transporter’s balance is held until the SDR is resolved, and the amount decided then is taken off
                  it — anything the balance cannot cover carries to their next orders.
                </Banner>
                <FormGrid>
                  <Field label="What went wrong">
                    <select value={sdrKind} onChange={(e) => setSdrKind(e.target.value as SdrKind)}>
                      {(Object.keys(SDR_KIND_LABEL) as SdrKind[]).map((k) => (
                        <option key={k} value={k}>
                          {SDR_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Believed to cost (₹)" hint="Optional — the deduction is fixed when the SDR is resolved">
                    <input
                      type="number"
                      min={0}
                      value={sdrClaimedRupees || ''}
                      onChange={(e) => setSdrClaimedRupees(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </Field>
                </FormGrid>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="eyebrow">Charges written on this document</div>
              {charges.map((c, i) => (
                <FormGrid key={i}>
                  <Field label="Charge type">
                    <select
                      value={c.chargeType}
                      onChange={(e) =>
                        setCharges(charges.map((x, j) => (i === j ? { ...x, chargeType: e.target.value } : x)))
                      }
                    >
                      {CHARGE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Cost to us (₹)">
                    <input
                      type="number"
                      value={c.costRupees || ''}
                      onChange={(e) =>
                        setCharges(charges.map((x, j) => (i === j ? { ...x, costRupees: Number(e.target.value) } : x)))
                      }
                    />
                  </Field>
                  <Field
                    label="Billed to client (₹)"
                    error={c.billedRupees > 0 && c.billedRupees < c.costRupees ? 'Below cost' : undefined}
                  >
                    <input
                      type="number"
                      value={c.billedRupees || ''}
                      onChange={(e) =>
                        setCharges(charges.map((x, j) => (i === j ? { ...x, billedRupees: Number(e.target.value) } : x)))
                      }
                    />
                  </Field>
                </FormGrid>
              ))}
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => setCharges([...charges, { chargeType: 'LOADING', costRupees: 0, billedRupees: 0 }])}
              >
                Add a charge
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setRejectOpen(true)}>
                Reject and request a replacement
              </button>
              <button className="btn" onClick={submitVerify} disabled={busy || (anyFailed && !remarks.trim())}>
                Verify
              </button>
            </div>
          </Panel>
        )}

        {pod.podStatus === 'VERIFIED' && (
          <Panel title="Approve">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Verified by {pod.verifiedBy ?? 'another user'}. Approval is the decision to pay — only an approval
              unblocks the balance.
            </p>
            {isVerifier ? (
              <Banner tone="flag" title="You verified this proof of delivery">
                So someone else on your team needs to approve it — the same person cannot do both steps.
              </Banner>
            ) : canApprove ? (
              <button className="btn" onClick={submitApprove} disabled={busy}>
                Approve
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 12.5 }}>
                Approval belongs to branch or compliance.
              </span>
            )}
          </Panel>
        )}

        {['APPROVED', 'WAIVED'].includes(pod.podStatus) && (
          <Banner tone="mint" title="Approved">
            The balance is unblocked. Finance still releases it — approval and disbursement stay separate.
          </Banner>
        )}

        {sdrs.length > 0 && (
          <Panel title="⚠️ Shortage / damage on this trip" pad={false}>
            <FactList
              facts={sdrs.map(
                (s) =>
                  [
                    `${s.code} · ${SDR_KIND_LABEL[s.kind]}`,
                    <span key={s.id}>
                      {s.description}
                      <span className="muted">
                        {' · '}
                        {s.status === 'OPEN'
                          ? `open${s.claimedPaise ? ` · claimed ${inr(s.claimedPaise)}` : ''} — holds the balance`
                          : `resolved · deduct ${inr(s.deductionPaise ?? 0)}`}
                      </span>
                    </span>,
                  ] as [string, ReactNode],
              )}
            />
            <div className="hint" style={{ padding: '10px 14px' }}>
              Resolved on the <Link href="/sdr">SDR</Link> screen, where the amount to deduct is decided.
            </div>
          </Panel>
        )}
      </Split>

      <Dialog
        open={rejectOpen}
        title="Reject this proof of delivery"
        body="It returns to the transporter for a replacement. Rejection does not stop the clock — the days between receipt and rejection re-enter the penalty accrual."
        confirmLabel="Reject"
        confirmDisabled={!rejectReason.trim()}
        busy={busy}
        onConfirm={submitReject}
        onClose={() => setRejectOpen(false)}
      >
        <Field label="Reason" required>
          <textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

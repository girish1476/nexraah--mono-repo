'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ApiError, errorMessage } from '@/apis';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
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
import {
  approvePod,
  getPod,
  logHardCopy,
  receivePod,
  rejectPod,
  uploadEpod,
  verifyHardCopy,
  verifyPod,
} from '../../apis';
import { POD_KIND_LABEL, PodDetail, PodFindings, PodKind } from '../../types';
import { DocPreview } from '@/components/doc-preview';
import { uploadAttachment } from '@/lib/attachments';
import { listSdr } from '@/app/sdr/apis';
import { SDR_KIND_LABEL, SdrRecord } from '@/app/sdr/types';
import { PodCheckDialog } from './pod-check-dialog';

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
  // Which proof is being checked in the verify dialog: the POD itself, or the hard copy behind an E-POD.
  const [checking, setChecking] = useState<'POD' | 'HARD_COPY' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [sdrs, setSdrs] = useState<SdrRecord[]>([]);
  // E-POD (a photo or scan of the signed note) or H-POD (the scan of the signed hard copy).
  const [podMode, setPodMode] = useState<PodKind>('EPOD');
  const [epodFiles, setEpodFiles] = useState<File[]>([]);
  // Optional on the E-POD: the hard copy's courier docket, if it has been sent.
  const [epodDocket, setEpodDocket] = useState({ courierDocket: '', sentOn: '' });
  const [hpodFiles, setHpodFiles] = useState<File[]>([]);

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

  // The hard copy (H-POD) behind an E-POD: just its scan.
  const [hcFiles, setHcFiles] = useState<File[]>([]);

  const uploadAll = async (files: File[], kind: string) => {
    const ids: string[] = [];
    for (const f of files) ids.push(await uploadAttachment(f, kind, 'trips', tripId));
    return ids;
  };

  /** After an E-POD: upload the scan of the hard copy. */
  const submitHardCopy = async () => {
    setBusy(true);
    try {
      const attachmentIds = await uploadAll(hcFiles, 'HPOD');
      await logHardCopy(tripId, { attachmentIds });
      toast('Hard copy uploaded · verify it to release the hold on the balance');
      setHcFiles([]);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const raised = (codes?: string[]) =>
    codes && codes.length > 0 ? ` · ${codes.join(', ')} raised — the balance is held until ${codes.length === 1 ? 'it is' : 'they are'} resolved` : '';

  const submitVerifyHardCopy = async (findings: PodFindings) => {
    setBusy(true);
    try {
      const result = await verifyHardCopy(tripId, findings);
      toast(`Hard copy verified · the balance is no longer held for it${raised(result.sdrCodes)}`);
      setChecking(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** H-POD: just the scan of the signed hard copy. */
  const submitReceive = async () => {
    setBusy(true);
    try {
      const attachmentIds = await uploadAll(hpodFiles, 'HPOD');
      const receipt = await receivePod(tripId, { attachmentIds });
      setHpodFiles([]);
      toast(`${receipt.code} · H-POD uploaded · the clock has stopped — it can be verified now`);
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
      const ids = await uploadAll(epodFiles, 'POD');
      const docket = epodDocket.courierDocket.trim();
      const receipt = await uploadEpod(
        tripId,
        ids,
        docket ? { hardCopyDocket: docket, ...(epodDocket.sentOn ? { hardCopySentOn: epodDocket.sentOn } : {}) } : undefined,
      );
      toast(`${receipt.code} · E-POD uploaded · it can be verified now; the balance waits for the hard copy`);
      setEpodFiles([]);
      setEpodDocket({ courierDocket: '', sentOn: '' });
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async (findings: PodFindings) => {
    setBusy(true);
    try {
      const kinds = (findings.findings ?? []).map((f) => f.kind);
      const result = await verifyPod(tripId, {
        ...findings,
        // The clerical checklist the server keeps, read off what the check found.
        checklist: {
          consigneeStamp: true,
          signedAndDated: true,
          lrNumberMatches: true,
          quantityMatchesInvoice: !kinds.includes('SHORTAGE'),
          noShortageOrDamage: kinds.length === 0,
        },
        charges: findings.charges ?? [],
      });
      const codes = result.sdrCodes ?? (result.sdrCode ? [result.sdrCode] : []);
      toast(
        codes.length > 0
          ? `Verified${raised(codes)}.`
          : session?.role === 'ADMIN'
            ? 'Verified · approve it to unblock the balance.'
            : 'Verified · a second person needs to approve it before the balance is released.',
      );
      setChecking(null);
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
  // BR-50: nobody approves what they verified — except an administrator.
  const blockedAsVerifier = isVerifier && session?.role !== 'ADMIN';
  const canVerify = can('pod.verify') && pod.podStatus === 'RECEIVED';
  const canApprove = can('pod.approve') && pod.podStatus === 'VERIFIED' && !blockedAsVerifier;

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
              Nothing has come in yet. Upload the E-POD, or the H-POD scan when the hard copy arrives.
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
                  It stops the clock and the delivery can be verified and closed straight away. The balance payment stays
                  on hold until the hard copy (H-POD) is uploaded and verified.
                </Banner>
                {can('pod.receive') ? (
                  <div style={{ marginTop: 12 }}>
                    <Field label="Photo or scan" required hint="One or more pages — photos or a PDF.">
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf"
                        aria-label="E-POD photo or scan"
                        onChange={(e) => setEpodFiles(Array.from(e.target.files ?? []))}
                      />
                    </Field>
                    <div className="eyebrow" style={{ marginTop: 12 }}>
                      Hard copy courier details — optional
                    </div>
                    <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
                      If the transporter has already couriered the signed hard copy, note its docket now. Leave blank if
                      not — you can add it later.
                    </p>
                    <FormGrid>
                      <Field label="H-POD courier docket">
                        <input
                          value={epodDocket.courierDocket}
                          onChange={(e) => setEpodDocket({ ...epodDocket, courierDocket: e.target.value })}
                          placeholder="e.g. DTDC 7X0012345"
                        />
                      </Field>
                      <Field label="H-POD sent on" hint="Defaults to today when a docket is entered.">
                        <input
                          type="date"
                          value={epodDocket.sentOn}
                          disabled={!epodDocket.courierDocket.trim()}
                          onChange={(e) => setEpodDocket({ ...epodDocket, sentOn: e.target.value })}
                        />
                      </Field>
                    </FormGrid>
                    <button
                      className="btn"
                      style={{ marginTop: 12 }}
                      disabled={
                        busy ||
                        epodFiles.length === 0 ||
                        (epodDocket.courierDocket.trim().length > 0 && epodDocket.courierDocket.trim().length < 3)
                      }
                      onClick={submitEpod}
                    >
                      Upload E-POD — close the delivery
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
            <Banner tone="flag" title="H-POD — upload the scan of the signed hard copy">
              {pod.podStatus === 'ATTACHED'
                ? 'The transporter has sent a photo. Upload the scan of the signed hard copy — that stops the clock and lets it be verified.'
                : 'Upload the scan of the signed hard copy once it reaches the branch. That stops the clock and lets it be verified.'}
            </Banner>
            {can('pod.receive') ? (
              <div style={{ marginTop: 12 }}>
                <Field label="Scan of the signed hard copy" required hint="One or more pages — photos or a PDF.">
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    aria-label="H-POD scan"
                    onChange={(e) => setHpodFiles(Array.from(e.target.files ?? []))}
                  />
                </Field>
                <button
                  className="btn"
                  style={{ marginTop: 12 }}
                  disabled={busy || hpodFiles.length === 0}
                  onClick={submitReceive}
                >
                  Upload H-POD — stop the clock
                </button>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                The branch receiving desk uploads the hard copy.
              </p>
            )}
              </>
            )}
          </Panel>
        ) : null}

        {/* After an E-POD: the delivery is closed, but the balance waits for the hard copy. */}
        {pod.podKind === 'EPOD' && pod.podStatus !== 'FORFEITED' && (
          <Panel
            title="📮 Hard copy (H-POD)"
            right={
              pod.hardCopy?.verifiedAt ? (
                <Tag tone="mint">Verified</Tag>
              ) : (pod.hardCopy?.attachmentIds ?? []).length > 0 ? (
                <Tag tone="blue">Uploaded · verify it</Tag>
              ) : (
                <Tag tone="flag">Waiting for the hard copy</Tag>
              )
            }
          >
            {pod.hardCopy?.verifiedAt ? (
              <Banner tone="mint" title="Hard copy verified">
                The balance is no longer held for the hard copy.
              </Banner>
            ) : (
              <Banner tone="flag" title="Balance payment on hold">
                The E-POD closed the delivery, but the transporter’s balance is released only once the signed hard copy
                is uploaded and verified.
              </Banner>
            )}

            {/* The docket noted with the E-POD, while the hard copy is on its way. */}
            {pod.hardCopy?.courierDocket && !pod.hardCopy?.receivedOn && (
              <div style={{ marginTop: 10 }}>
                <FactList
                  facts={[
                    ['Courier docket', pod.hardCopy.courierDocket],
                    ['Sent on', fmtDate(pod.hardCopy.sentOn ?? null)],
                  ]}
                />
              </div>
            )}

            {(pod.hardCopy?.receivedOn || pod.hardCopy?.verifiedAt) && (
              <div style={{ marginTop: 10 }}>
                <FactList
                  facts={[
                    ...(pod.hardCopy?.courierDocket
                      ? ([['Courier docket', pod.hardCopy.courierDocket]] as [string, ReactNode][])
                      : []),
                    ['Uploaded on', fmtDate(pod.hardCopy?.receivedOn ?? null)],
                    ...(pod.hardCopy?.verifiedAt
                      ? ([
                          ['Verified on', fmtDate(pod.hardCopy.verifiedAt)],
                          ['Received by', pod.hardCopy.details?.receivedByName ?? '—'],
                          ['Quantity received', pod.hardCopy.details?.quantityReceived ?? '—'],
                          ['Remarks', pod.hardCopy.details?.remarks ?? '—'],
                        ] as [string, ReactNode][])
                      : []),
                  ]}
                />
              </div>
            )}

            {(pod.hardCopy?.attachmentIds ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {(pod.hardCopy?.attachmentIds ?? []).map((attachmentId, i) => (
                  <DocPreview key={attachmentId} attachmentId={attachmentId} label={`Hard copy, page ${i + 1}`} width={120} height={150} />
                ))}
              </div>
            )}

            {!pod.hardCopy?.verifiedAt && (pod.hardCopy?.attachmentIds ?? []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                {can('pod.verify') ? (
                  <button className="btn" disabled={busy} onClick={() => setChecking('HARD_COPY')}>
                    Verify the hard copy — release the hold
                  </button>
                ) : (
                  <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                    Compliance or Operations verifies the hard copy.
                  </p>
                )}
              </div>
            )}

            {!pod.hardCopy?.verifiedAt &&
              (can('pod.receive') ? (
                <div style={{ marginTop: 14 }}>
                  <Field
                    label={(pod.hardCopy?.attachmentIds ?? []).length > 0 ? 'Replace the hard copy scan' : 'Scan of the signed hard copy'}
                    hint="Upload it once it reaches the office — photos or a PDF."
                  >
                    <input
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      aria-label="Hard copy scan"
                      onChange={(e) => setHcFiles(Array.from(e.target.files ?? []))}
                    />
                  </Field>
                  <button
                    className="btn"
                    style={{ marginTop: 12 }}
                    disabled={busy || hcFiles.length === 0}
                    onClick={submitHardCopy}
                  >
                    Upload the hard copy
                  </button>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                  Operations or the branch uploads the hard copy.
                </p>
              ))}
          </Panel>
        )}

        {canVerify && (
          <Panel title="Verify" right={<Tag tone="flag">Waiting for check</Tag>}>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Check the {pod.podKind === 'HPOD' ? 'H-POD' : 'E-POD'} like any other document: open it beside its details,
              type what is written on it, and record any shortage, damage, transit delay or charges.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy} onClick={() => setChecking('POD')}>
                Verify
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setRejectOpen(true)}>
                Reject and request a replacement
              </button>
            </div>
          </Panel>
        )}

        {/* What was typed in when the proof was checked. */}
        {pod.details && ['VERIFIED', 'APPROVED', 'WAIVED'].includes(pod.podStatus) && (
          <Panel title="Details on the proof" pad={false}>
            <FactList
              facts={[
                ['Delivered on', fmtDate(pod.deliveredAt)],
                ['Received by', pod.details.receivedByName ?? '—'],
                ['Quantity received', pod.details.quantityReceived ?? '—'],
                ['Remarks', pod.details.remarks ?? '—'],
              ]}
            />
          </Panel>
        )}

        {pod.podStatus === 'VERIFIED' && (
          <Panel title="Approve">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Verified by {isVerifier ? 'you' : (pod.verifiedBy ?? 'another user')}. Approval is the decision to pay —
              only an approval unblocks the balance.
            </p>
            {blockedAsVerifier ? (
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

        {['APPROVED', 'WAIVED'].includes(pod.podStatus) &&
          (pod.hardCopyHoldsBalance ? (
            <Banner tone="flag" title="Approved — delivery closed, balance on hold">
              The E-POD is approved, so the delivery is closed. The balance is released once the hard copy (H-POD) is
              uploaded and verified above.
            </Banner>
          ) : (
            <Banner tone="mint" title="Approved">
              The balance is unblocked. Finance still releases it — approval and disbursement stay separate.
            </Banner>
          ))}

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

      {/* One check for every proof — the scan beside its details, like the other documents. */}
      <PodCheckDialog
        open={checking !== null}
        title={
          checking === 'HARD_COPY'
            ? 'Verify · Hard copy (H-POD)'
            : `Verify · ${pod.podKind === 'HPOD' ? 'H-POD' : 'E-POD'}`
        }
        attachmentIds={checking === 'HARD_COPY' ? (pod.hardCopy?.attachmentIds ?? []) : pod.attachmentIds}
        deliveredAt={pod.deliveredAt}
        actualTransitDays={pod.actualTransitDays}
        transitDaysRequired={pod.transitDaysRequired}
        transitPenaltyPaise={pod.transitPenaltyPaise}
        busy={busy}
        onConfirm={(findings) => (checking === 'HARD_COPY' ? submitVerifyHardCopy(findings) : submitVerify(findings))}
        onClose={() => setChecking(null)}
      />

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

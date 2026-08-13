'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAtomValue } from 'jotai';
import { ApiError, errorMessage } from '@/apis';
import { CHARGE_TYPES, POD_TONE } from '@/lib/documents';
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
  ModuleGuard,
  PageHeader,
  Panel,
  Split,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { approvePod, getPod, rejectPod, verifyPod } from '../../apis';
import { PodDetail, VerifyChecklist } from '../../types';

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
 * Verify and approve — `/pod/[id]/verify` (part 06 §3).
 *
 * Two acts, two people. The verifier cannot approve their own proof of
 * delivery: the button does not render, the service refuses, and a database
 * constraint refuses as well (BR-50). Charges are captured here, because
 * verification is the moment someone is actually reading the document.
 */
export default function PodVerifyPage() {
  const { id } = useParams<{ id: string }>();
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

  const load = () => {
    setError(null);
    getPod(id).then(setPod).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const anyFailed = Object.values(checklist).some((v) => !v);

  const submitVerify = async () => {
    setBusy(true);
    try {
      await verifyPod(id, {
        checklist,
        remarks: remarks || undefined,
        charges: charges.map((c) => ({
          chargeType: c.chargeType,
          costAmountPaise: Math.round(c.costRupees * 100),
          billedAmountPaise: Math.round(c.billedRupees * 100),
        })),
      });
      toast('Verified · a second person must approve it (BR-50)');
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
      await approvePod(id);
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
      await rejectPod(id, rejectReason);
      toast('Rejected · returned to the transporter and the clock resumes (BR-52)');
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
    <ModuleGuard module="pod">
      <PageHeader
        path={`/pod/${pod.tripCode}/verify`}
        title={`Proof of delivery · ${pod.tripCode}`}
        sub={`${pod.lane} · ${pod.vendorName} · delivered ${fmtDate(pod.deliveredAt)}`}
        module="pod"
        right={<Tag tone={POD_TONE[pod.podStatus] as Tone}>{pod.podStatus}</Tag>}
      />

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
                  ['Penalty accrued', inr(pod.penaltyPaise)],
                  ['Pages', pod.pages],
                ]}
              />
            </Panel>
            {pod.receipt && (
              <Panel title="Receiving record" pad={false}>
                <FactList
                  facts={[
                    ['Receipt', pod.receipt.code],
                    ['Courier docket', pod.receipt.courierDocket],
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
        <Panel title="Document">
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              padding: 20,
              background: 'var(--grey-tint)',
              justifyContent: 'center',
            }}
          >
            {pod.attachmentIds.map((attachmentId, i) => (
              <div
                key={attachmentId}
                style={{
                  width: 150,
                  height: 200,
                  border: '1px solid var(--color-divider)',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}
                className="muted"
              >
                Page {i + 1}
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            Pages are served on 15-minute signed URLs. Nothing is downloaded permanently.
          </p>
        </Panel>

        {pod.podStatus === 'PENDING' || pod.podStatus === 'ATTACHED' ? (
          <Banner tone="flag" title="The physical copy has not been logged">
            Verification begins once the branch logs the paper against its courier docket. A photograph does not
            stop the clock (BR-49).
          </Banner>
        ) : null}

        {canVerify && (
          <Panel title="Verify">
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

            <div style={{ marginTop: 16 }}>
              <div className="eyebrow">Charges written on this document (BR-56)</div>
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
              Verified by {pod.verifiedBy ?? 'another user'}. Approval is the decision to pay, and only it
              unblocks the balance (BR-10).
            </p>
            {isVerifier ? (
              <Banner tone="flag" title="You verified this proof of delivery">
                Someone else must approve it. That is BR-50, and it is enforced by the service and by a database
                constraint as well as by this screen.
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
      </Split>

      <Dialog
        open={rejectOpen}
        title="Reject this proof of delivery"
        body="It returns to the transporter for a replacement. Rejection does not stop the clock — the days between receipt and rejection re-enter the penalty accrual (BR-52)."
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
    </ModuleGuard>
  );
}

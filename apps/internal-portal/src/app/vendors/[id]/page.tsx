'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, ApprovalRequiredError, errorMessage, request } from '@/apis';
import { fmtDate, inr, inrCompact, pct } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { ROLES, RoleCode } from '@/lib/permissions';
import {
  Banner,
  BlockedPanel,
  Column,
  DataTable,
  Dialog,
  ErrorState,
  FactList,
  Field,
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
import { UnmetCondition } from '@/apis';
import {
  activateVendor,
  submitVendor,
  changeAdvancePolicy,
  getVendor,
  reinstateVendor,
  rejectDocument,
  rejectKyc,
  submitKyc,
  suspendVendor,
  uploadVendorDocument,
  verifyDocument,
  verifyKyc,
} from '../apis';
import { CheckStatus, FleetRow, KycItem, VendorDetail, VendorDocument } from '../types';
import { DocPreview } from '@/components/doc-preview';
import { UploadCell } from '../upload-cell';
import { VendorPlacements } from './placements';

const CHECK_TONE: Record<CheckStatus, Tone> = {
  MISSING: 'red',
  PENDING: 'flag',
  VERIFIED: 'mint',
  REJECTED: 'red',
};

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const AADHAAR_LAST4_RE = /^\d{4}$/;

/** Same rules as the onboarding wizard's KYC capture — kept in sync deliberately. */
const KYC_NORMALIZE: Record<string, (value: string) => string> = {
  PAN: (v) => v.toUpperCase().slice(0, 10),
  AADHAAR: (v) => v.replace(/\D/g, '').slice(0, 4),
};
const KYC_VALIDATE: Record<string, (value: string) => string | undefined> = {
  PAN: (v) => (PAN_RE.test(v) ? undefined : 'PAN looks wrong, e.g. AAKCR2148L'),
  AADHAAR: (v) => (AADHAAR_LAST4_RE.test(v) ? undefined : 'Enter the last four digits only'),
};
const KYC_TITLE: Record<string, string> = {
  PAN: 'PAN card',
  AADHAAR: 'Aadhaar card',
  ADDRESS: 'Address proof',
  SELFIE: 'Yard photo (time and location stamped)',
};
const KYC_NUMBER_LABEL: Record<string, string> = {
  PAN: 'PAN number',
  AADHAAR: 'Aadhaar number',
  ADDRESS: 'Reference',
};

/** "FY 2026-27" for the financial year (1 April – 31 March) a `YYYY-MM-DD` date falls in. */
function financialYearLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String(start + 1).slice(2)}`;
}

const KYC_PLACEHOLDER: Record<string, string> = {
  PAN: 'PAN number',
  AADHAAR: 'Last four digits',
  ADDRESS: 'Reference',
};

/**
 * Vendor file — `/vendors/[id]`.
 *
 * Two segments (part 03 §2): what they cost us and what they earned us, and
 * the compliance file itself. `Clear and activate` enables only on a complete
 * file — the server refuses regardless, and returns the unmet list by name.
 */
export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const can = useCan();
  const toast = useToast();

  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unmet, setUnmet] = useState<UnmetCondition[]>([]);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyPct, setPolicyPct] = useState('40');
  const [policyReason, setPolicyReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [rejecting, setRejecting] = useState<{ table: 'kyc' | 'document'; kind: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const apply = (v: VendorDetail) => {
    // The advance figure moving means the pending request was approved — the
    // approver works from another screen, so this is the only signal here.
    if (vendor && v.advancePct !== vendor.advancePct) setAwaitingApproval(false);
    setVendor(v);
    setUnmet(pendingItems(v));
  };
  const load = () => {
    setError(null);
    getVendor(id)
      .then(apply)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);
  // An approval lands from the approver's screen, not this one — without this
  // the old advance % stayed on screen until a manual reload.
  useLiveRefresh(() => getVendor(id).then(apply));

  // A vendor left as a draft (a tab closed before the last wizard step) had no way
  // to be sent for verification from its own page.
  const onSubmitForVerification = async () => {
    setBusy(true);
    try {
      await submitVendor(id);
      load();
      setUnmet([]);
      toast('Sent to Compliance for verification');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VENDOR_INCOMPLETE') {
        setUnmet(e.unmet);
        toast('Not sent — the file is incomplete');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  // The server answers with a narrow `{ id, status, portalAccountProvisioned }`,
  // not the vendor — re-fetch for the full record, and let the real
  // `portalAccountProvisioned` flag (not a fixed claim) decide what the toast says.
  const onActivate = async () => {
    setBusy(true);
    try {
      const result = await activateVendor(id);
      load();
      setUnmet([]);
      setConfirmActivate(false);
      toast(
        result.portalAccountProvisioned
          ? 'Vendor activated · awardable across every branch · portal login created'
          : 'Vendor activated · awardable across every branch · portal login not yet set up',
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VENDOR_INCOMPLETE') {
        setUnmet(e.unmet);
        setConfirmActivate(false);
        toast('Activation refused — the file is incomplete');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  // Hold and off-hold answer with `{ id, status }` — re-fetch for the record.
  const onHold = async () => {
    setBusy(true);
    try {
      await suspendVendor(id, holdReason.trim());
      setHoldOpen(false);
      setHoldReason('');
      load();
      toast('On hold · no new loads until taken off hold · running trips continue');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onOffHold = async () => {
    setBusy(true);
    try {
      await reinstateVendor(id);
      load();
      toast('Off hold · awardable again');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Both verify calls answer with `{ kind, status }`, not the vendor — re-fetch
  // so the unmet list and the activate button reflect the new state.
  const onVerifyKyc = async (kind: string) => {
    try {
      await verifyKyc(id, kind);
      load();
      toast(`Verified · ${kind}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onVerifyDocument = async (kind: string) => {
    try {
      await verifyDocument(id, kind);
      load();
      toast(`Verified · ${kind.replace(/_/g, ' ')}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onRejectSubmit = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      if (rejecting.table === 'kyc') {
        await rejectKyc(id, rejecting.kind, rejectReason);
      } else {
        await rejectDocument(id, rejecting.kind, rejectReason);
      }
      load();
      toast(`Rejected · ${rejecting.kind.replace(/_/g, ' ')}`);
      setRejecting(null);
      setRejectReason('');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Completes a KYC item or document that's MISSING or REJECTED without
   * sending the operator back through the onboarding wizard — a stranded
   * DRAFT (created at wizard step 1, then abandoned before any upload) had
   * no way to be finished from here otherwise, and neither did re-uploading
   * a REJECTED item. Same multipart-then-reference pattern the wizard uses.
   */
  const attach = async (
    file: File,
    meta: { kind?: string; entityType?: string; entityId?: string; latitude?: number; longitude?: number } = {},
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (meta.kind) formData.append('kind', meta.kind);
    if (meta.entityType) formData.append('entityType', meta.entityType);
    if (meta.entityId) formData.append('entityId', meta.entityId);
    if (meta.latitude !== undefined) formData.append('latitude', String(meta.latitude));
    if (meta.longitude !== undefined) formData.append('longitude', String(meta.longitude));
    const { id: attachmentId } = await request<{ id: string; sha256: string }>({
      url: '/attachments',
      method: 'POST',
      data: formData,
    });
    return attachmentId;
  };

  const onUploadKyc = async (kind: string, value: string, file: File) => {
    try {
      // No browser location: the yard photo carries its own printed time and
      // place stamp, and that is what Compliance verifies.
      const attachmentId = await attach(file, { kind, entityType: 'vendor', entityId: id });
      await submitKyc(id, kind, { value, route: 'MANUAL', attachmentId });
      load();
      toast(`${kind} uploaded · queued for compliance`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onUploadDocument = async (kind: string, reference: string, file: File) => {
    try {
      const attachmentId = await attach(file, { kind, entityType: 'vendor', entityId: id });
      await uploadVendorDocument(id, kind, { attachmentId, ...(reference ? { reference } : {}) });
      load();
      toast(`${kind.replace(/_/g, ' ')} uploaded · queued for compliance`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onPolicySubmit = async () => {
    setBusy(true);
    try {
      await changeAdvancePolicy(id, Number(policyPct), policyReason);
      toast('Advance policy change requested');
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        setAwaitingApproval(true);
        setPolicyOpen(false);
        setPolicyReason('');
        const approver = ROLES[e.approval.approverRole as RoleCode]?.label ?? e.approval.approverRole;
        toast(`Sent to ${approver} · not applied until they approve it`);
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!vendor) return <Loading what="Loading the vendor file" />;

  /*
   * Identity checks and the legal file are shown the way an order's documents
   * are: the file itself beside what is written on it. These papers are held
   * for later disputes, so the photo has to be on the page — a row saying
   * "Verified" with nothing to open is not a record of anything.
   */
  const statusTag = (status: CheckStatus) =>
    status === 'VERIFIED' ? (
      <Tag tone="mint">Verified</Tag>
    ) : status === 'PENDING' ? (
      <Tag tone="flag">Waiting for Compliance</Tag>
    ) : status === 'REJECTED' ? (
      <Tag tone="red">Rejected — upload again</Tag>
    ) : (
      <Tag tone="grey">Not uploaded</Tag>
    );

  const kycCard = (r: KycItem) => (
    <div key={r.kind} data-doc={r.kind} className="doc-card">
      <DocPreview attachmentId={r.attachmentId ?? null} label={KYC_TITLE[r.kind] ?? r.kind} />
      <div style={{ minWidth: 0 }}>
        <div className="doc-card-head">
          <strong>{KYC_TITLE[r.kind] ?? r.kind}</strong>
          {statusTag(r.status)}
        </div>
        <dl className="doc-facts">
          {r.kind !== 'SELFIE' && (
            <div style={{ display: 'contents' }}>
              <dt>{KYC_NUMBER_LABEL[r.kind] ?? 'Reference'}</dt>
              <dd className="mono">
                {r.valueMasked ? (r.kind === 'AADHAAR' ? `XXXX XXXX ${r.valueMasked}` : r.valueMasked) : '—'}
              </dd>
            </div>
          )}
          {r.verifiedAt && (
            <div style={{ display: 'contents' }}>
              <dt>Verified on</dt>
              <dd>{fmtDate(r.verifiedAt)}</dd>
            </div>
          )}
        </dl>
        {r.kind === 'SELFIE' && r.status === 'PENDING' && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Check the date, time and address printed on the photo match this transporter’s yard.
          </div>
        )}
        {r.status === 'REJECTED' && r.rejectReason && (
          <div style={{ color: 'var(--red)', fontSize: 'var(--text-sm)', marginTop: 8 }}>Rejected: {r.rejectReason}</div>
        )}
        {r.geo && (
          <div style={{ marginTop: 8 }}>
            <a
              className="muted"
              style={{ fontSize: 11.5 }}
              href={`https://maps.google.com/?q=${r.geo.lat},${r.geo.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <span aria-hidden>📍</span> Where it was uploaded from — opens the map
            </a>
          </div>
        )}
        <div className="doc-actions">
          {can('vendor.verify') && r.status === 'PENDING' && (
            <>
              <button className="btn btn-sm" onClick={() => onVerifyKyc(r.kind)}>
                Verify
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setRejecting({ table: 'kyc', kind: r.kind })}>
                Reject
              </button>
            </>
          )}
          {/* Verified by mistake — the wrong paper, or one that does not match. Taking the
              verification back sends it to be uploaded again, with the reason on record. */}
          {can('vendor.verify') && r.status === 'VERIFIED' && (
            <button className="btn btn-secondary btn-sm" onClick={() => setRejecting({ table: 'kyc', kind: r.kind })}>
              Wrong document — reject
            </button>
          )}
          {can('vendor.edit') && (r.status === 'MISSING' || r.status === 'REJECTED') && (
            <UploadCell
              placeholder={KYC_PLACEHOLDER[r.kind] ?? 'Reference'}
              needsReference={r.kind !== 'SELFIE'}
              imageOnly={r.kind === 'SELFIE'}
              normalize={KYC_NORMALIZE[r.kind]}
              validate={KYC_VALIDATE[r.kind]}
              onUpload={(value, file) => onUploadKyc(r.kind, value, file)}
            />
          )}
        </div>
      </div>
    </div>
  );

  const today = new Date().toLocaleDateString('en-CA');

  const docCard = (r: VendorDocument) => {
    const title = r.kind.replace(/_/g, ' ');
    /*
     * A TDS declaration covers one financial year (1 April – 31 March) and is
     * due again once that year has ended. One uploaded before the year was
     * recorded says nothing about which year it covers, so it is asked for
     * again too. Uploading the new one replaces what is shown here and goes
     * back to Compliance to verify.
     */
    const yearly = r.kind === 'TDS_DECLARATION';
    const due = yearly && r.status !== 'MISSING' && (!r.validTo || r.validTo.slice(0, 10) < today);
    return (
      <div key={r.kind} data-doc={r.kind} className="doc-card">
        <DocPreview attachmentId={r.attachmentId} label={title} />
        <div style={{ minWidth: 0 }}>
          <div className="doc-card-head">
            <strong>{title}</strong>
            {due ? <Tag tone="red">Due for {financialYearLabel(today)}</Tag> : statusTag(r.status)}
          </div>
          <dl className="doc-facts">
            <div style={{ display: 'contents' }}>
              <dt>Reference</dt>
              <dd className="mono">{r.reference ?? '—'}</dd>
            </div>
            {yearly ? (
              <div style={{ display: 'contents' }}>
                <dt>Financial year</dt>
                <dd>
                  {r.validTo
                    ? `${financialYearLabel(r.validTo)} · until ${fmtDate(r.validTo)}`
                    : r.status === 'MISSING'
                      ? '—'
                      : 'Not recorded'}
                </dd>
              </div>
            ) : (
              <div style={{ display: 'contents' }}>
                <dt>Valid to</dt>
                <dd>{fmtDate(r.validTo)}</dd>
              </div>
            )}
          </dl>
          {yearly && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Needed afresh every financial year. Upload the new year’s declaration here after 31 March.
            </div>
          )}
          {r.status === 'REJECTED' && r.rejectReason && (
            <div style={{ color: 'var(--red)', fontSize: 'var(--text-sm)', marginTop: 8 }}>Rejected: {r.rejectReason}</div>
          )}
          <div className="doc-actions">
            {can('vendor.verify') && r.status === 'PENDING' && (
              <>
                <button className="btn btn-sm" onClick={() => onVerifyDocument(r.kind)}>
                  Verify
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setRejecting({ table: 'document', kind: r.kind })}
                >
                  Reject
                </button>
              </>
            )}
            {can('vendor.verify') && r.status === 'VERIFIED' && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRejecting({ table: 'document', kind: r.kind })}
              >
                Wrong document — reject
              </button>
            )}
            {can('vendor.edit') && (r.status === 'MISSING' || r.status === 'REJECTED' || due) && (
              <UploadCell
                placeholder="Reference or number"
                needsReference={!yearly}
                onUpload={(value, file) => onUploadDocument(r.kind, value, file)}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const fleetColumns: Column<FleetRow>[] = [
    { key: 'reg', label: 'Registration', mono: true, render: (r) => r.registration },
    { key: 'type', label: 'Type', render: (r) => `${r.type} · ${r.capacityTn} MT` },
    { key: 'body', label: 'Body', render: (r) => r.bodyType },
    { key: 'city', label: 'Currently', render: (r) => r.currentCity },
    {
      key: 'status',
      label: 'State',
      render: (r) => (
        <Tag tone={r.status === 'AVAILABLE' ? 'mint' : r.status === 'DOCS_DUE' ? 'red' : 'grey'}>
          {r.status.replace(/_/g, ' ')}
        </Tag>
      ),
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path={`/vendors/${vendor.code}`}
        title={vendor.legalName}
        sub={`${vendor.code} · ${vendor.baseCity}${vendor.constitution ? ` · ${vendor.constitution.toLowerCase()}` : ''}`}
        module="vendors"
        badge={
          vendor.status === 'ACTIVE' && (
            <Tag tone="mint" emoji reason={`Cleared by ${vendor.verifiedBy ?? 'compliance'}`}>
              Vendor active
            </Tag>
          )
        }
        right={
          vendor.status === 'ACTIVE' &&
          can('vendor.activate') && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setHoldOpen(true)}>
              Put on hold
            </button>
          )
        }
      />

      <Split
        aside={
          <>
            <Panel title="Vendor" pad={false}>
              <FactList
                facts={[
                  ['Code', vendor.code],
                  ['GSTIN', vendor.gstin ?? '—'],
                  ['PAN', vendor.pan],
                  ['Party type', vendor.partyType],
                  ['Branch', vendor.branchName],
                  ['Fleet', `${vendor.fleetCount} trucks`],
                  ['Truck types', vendor.truckTypes?.length ? vendor.truckTypes.join(', ') : '—'],
                  ['Operating', vendor.operatingStates.join(', ')],
                  ['On panel since', fmtDate(vendor.panelDate)],
                  ['Bank', `${vendor.bankAccount} · ${vendor.ifsc}`],
                ]}
              />
            </Panel>

            <Panel title="Advance policy">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="mono" style={{ fontSize: 23 }}>
                  {vendor.advancePct}%
                </span>
                {can('vendor.advance_policy') && !awaitingApproval && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setPolicyPct(String(vendor.advancePct));
                      setPolicyOpen(true);
                    }}
                  >
                    Change
                  </button>
                )}
                {awaitingApproval && <Tag tone="flag">Awaiting approval</Tag>}
              </div>
              <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 0 }}>
                {can('vendor.advance_policy')
                  ? 'Set by compliance and capped on every advance this vendor requests. A change is not applied until it is approved.'
                  : 'Set by compliance. Read-only here.'}
              </p>
              {vendor.advanceHistory.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="eyebrow">History</div>
                  {vendor.advanceHistory.map((h, i) => (
                    <div key={i} className="muted" style={{ fontSize: 11.5 }}>
                      {h.oldPct === null ? 'Set' : `${h.oldPct}% →`} {h.newPct}% · {h.changedBy} ·{' '}
                      {fmtDate(h.changedAt)}
                      {h.approvalId ? ' · approved' : ''}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Money with us" pad={false}>
              <FactList
                facts={[
                  ['Advance outstanding', inr(vendor.business.advanceOutstandingPaise)],
                  ['Balance pending', inr(vendor.business.balancePendingPaise)],
                  ['Penalties accrued', inr(vendor.business.penaltiesAccruedPaise)],
                ]}
              />
            </Panel>
          </>
        }
      >
        {/* An active vendor says so beside its name in the header — no banner. */}
        {vendor.status === 'ACTIVE' ? null : vendor.status === 'SUSPENDED' ? (
          <Banner tone="red" title="On hold — no new loads">
            Compliance has put this transporter on hold. They cannot be awarded a load and their portal is
            read-only; trips already on the road carry on. The reason is on the audit trail.
            {can('vendor.activate') && (
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-sm" disabled={busy} onClick={onOffHold}>
                  Take off hold
                </button>
              </div>
            )}
          </Banner>
        ) : vendor.status === 'BLACKLISTED' ? (
          <Banner tone="red" title="Blacklisted">
            This transporter is not to be used again. There is no way back from here in the console.
          </Banner>
        ) : vendor.status === 'DRAFT' ? (
          <BlockedPanel
            title="Not sent for verification yet"
            subtitle={
              can('vendor.edit')
                ? 'Add what is missing, then send it to Compliance.'
                : 'This transporter has not been sent for verification yet.'
            }
            unmet={unmet}
            action={
              can('vendor.edit') && (
                <button className="btn" disabled={busy} onClick={onSubmitForVerification}>
                  Submit for verification
                </button>
              )
            }
            note="Compliance checks the papers and activates the vendor. Until then it cannot be awarded an indent."
          />
        ) : (
          <BlockedPanel
            title="Vendor not yet active"
            subtitle={
              can('vendor.activate')
                ? 'Activation is yours to grant once every item below clears.'
                : 'Compliance clears vendors. Until they do, this vendor cannot be awarded an indent.'
            }
            unmet={unmet}
            action={
              can('vendor.activate') && (
                <button
                  className="btn"
                  disabled={unmet.length > 0}
                  onClick={() => setConfirmActivate(true)}
                >
                  Clear and activate
                </button>
              )
            }
            note="Activating makes the vendor awardable across every branch. Portal login setup follows separately."
          />
        )}

        {(vendor.business.recoverableBalancePaise ?? 0) > 0 && (
          <Banner tone="flag" title="Negative balance on this transporter’s account">
            They owe {inr(vendor.business.recoverableBalancePaise ?? 0)} from shortage and damage records. It is taken from
            their next payments, and shows against each order it is recovered from.{' '}
            <Link href={`/sdr`}>Open the SDR list →</Link>
          </Banner>
        )}

        <Panel title="Trips and business" pad={false}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px', padding: '12px 15px' }}>
            {(
              [
                ['🚚', 'Trips', String(vendor.business.trips), undefined],
                ['💰', 'Revenue', inrCompact(vendor.business.revenuePaise), undefined],
                ['📈', 'Our margin', inrCompact(vendor.business.marginPaise), 'var(--mint)'],
                [
                  '％',
                  'Margin %',
                  pct(
                    vendor.business.revenuePaise
                      ? (vendor.business.marginPaise / vendor.business.revenuePaise) * 100
                      : 0,
                  ),
                  undefined,
                ],
              ] as [string, string, string, string | undefined][]
            ).map(([icon, label, value, color]) => (
              <div key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <span aria-hidden style={{ fontSize: 15 }}>
                  {icon}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {label}
                </span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 600, color }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <div style={{ padding: '0 15px 14px' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Top lanes
            </div>
            {vendor.business.topLanes.map((l) => (
              <div key={l.lane} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span>{l.lane}</span>
                <span className="mono">
                  {l.trips} trips · {pct(l.marginPct)}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <VendorPlacements vendorId={id} vendorCode={vendor.code} />

        <Panel title="Identity checks">
          <div style={{ display: 'grid', gap: 12 }}>{vendor.kyc.map(kycCard)}</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
            Only the last 4 digits of Aadhaar are stored, to protect the transporter&apos;s privacy. Photos are
            stored securely and only Compliance staff can open them.
          </div>
        </Panel>

        <Panel title="Legal file">
          <div style={{ display: 'grid', gap: 12 }}>{vendor.documents.map(docCard)}</div>
        </Panel>

        <Panel title="Fleet" pad={false}>
          <DataTable columns={fleetColumns} rows={vendor.fleet} rowKey={(r) => r.registration} empty="No trucks recorded." />
        </Panel>
      </Split>

      <Dialog
        open={confirmActivate}
        title="Clear and activate vendor"
        body="Activating makes this vendor awardable across every branch. Compliance is the only role that can do this. Portal login setup happens separately."
        facts={[
          ['Vendor', vendor.legalName],
          ['GSTIN', vendor.gstin ?? '—'],
          ['Documents', `${vendor.documents.filter((d) => d.status === 'VERIFIED').length} of ${vendor.documents.length} verified`],
          ['Advance policy', `${vendor.advancePct}%`],
        ]}
        confirmLabel="Activate"
        busy={busy}
        onConfirm={onActivate}
        onClose={() => setConfirmActivate(false)}
      />

      <Dialog
        open={holdOpen}
        title="Put this transporter on hold"
        body="From now until they are taken off hold: no new loads can be awarded to them, and their portal becomes read-only. Trips already moving are not affected. This is not a blacklist — it can be undone from this page."
        facts={[
          ['Transporter', vendor.legalName],
          ['Cleared by', vendor.verifiedBy ?? '—'],
        ]}
        confirmLabel="Put on hold"
        confirmDisabled={holdReason.trim().length < 20}
        busy={busy}
        onConfirm={onHold}
        onClose={() => {
          setHoldOpen(false);
          setHoldReason('');
        }}
      >
        <Field label="Reason" required hint="At least 20 characters — it is written to the audit trail.">
          <textarea rows={3} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={policyOpen}
        title="Change the advance policy"
        body="This is not applied when you submit it. It goes out for approval and takes effect only once a role senior to operations approves it."
        confirmLabel="Request change"
        confirmDisabled={policyPct === '' || policyReason.trim().length < 20}
        busy={busy}
        onConfirm={onPolicySubmit}
        onClose={() => setPolicyOpen(false)}
      >
        <Field label="New advance %" required>
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder="e.g. 40"
            value={policyPct}
            onChange={(e) => setPolicyPct(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </Field>
        <Field label="Reason" required hint="At least 20 characters — it is stored on the approval and audited.">
          <textarea rows={3} value={policyReason} onChange={(e) => setPolicyReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={rejecting !== null}
        title={rejecting ? `Reject · ${rejecting.kind.replace(/_/g, ' ')}` : ''}
        body="This is sent back to Operations to fix and resubmit. The vendor cannot be activated until it is corrected and verified."
        confirmLabel="Reject"
        confirmDisabled={rejectReason.trim().length < 20}
        busy={busy}
        onConfirm={onRejectSubmit}
        onClose={() => {
          setRejecting(null);
          setRejectReason('');
        }}
      >
        <Field label="Reason" required hint="At least 20 characters — it is stored on the audit trail.">
          <textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

/** Presentation-side mirror of the server's activation gate, for first paint. */
function pendingItems(v: VendorDetail): UnmetCondition[] {
  if (v.status === 'ACTIVE') return [];
  return [
    ...v.kyc
      .filter((k) => k.status !== 'VERIFIED')
      .map((k) => ({
        key: k.kind,
        label: `${k.kind} not verified`,
        state: (k.status === 'MISSING' ? 'MISSING' : 'UNVERIFIED') as UnmetCondition['state'],
      })),
    ...v.documents
      .filter((d) => d.status !== 'VERIFIED')
      .map((d) => ({
        key: d.kind,
        label: `${d.kind.replace(/_/g, ' ')} ${d.status === 'MISSING' ? 'not on file' : d.status.toLowerCase()}`,
        state: (d.status === 'MISSING' ? 'MISSING' : 'UNVERIFIED') as UnmetCondition['state'],
      })),
  ];
}

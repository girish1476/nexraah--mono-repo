'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, ApprovalRequiredError, errorMessage } from '@/apis';
import { fmtDate, inr, inrCompact, pct } from '@/lib/format';
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
import { activateVendor, changeAdvancePolicy, getVendor, verifyKyc } from '../apis';
import { CheckStatus, FleetRow, KycItem, VendorDetail, VendorDocument } from '../types';

const CHECK_TONE: Record<CheckStatus, Tone> = {
  MISSING: 'red',
  PENDING: 'flag',
  VERIFIED: 'mint',
  REJECTED: 'red',
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
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyPct, setPolicyPct] = useState(40);
  const [policyReason, setPolicyReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  const load = () => {
    setError(null);
    getVendor(id)
      .then((v) => {
        setVendor(v);
        setPolicyPct(v.advancePct);
        setUnmet(pendingItems(v));
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const onActivate = async () => {
    setBusy(true);
    try {
      const updated = await activateVendor(id);
      setVendor(updated);
      setUnmet([]);
      setConfirmActivate(false);
      toast('Vendor activated · awardable across every branch · portal login created');
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

  const onVerifyKyc = async (kind: string) => {
    try {
      const updated = await verifyKyc(id, kind);
      setVendor(updated);
      setUnmet(pendingItems(updated));
      toast(`Verified · ${kind}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onPolicySubmit = async () => {
    setBusy(true);
    try {
      await changeAdvancePolicy(id, policyPct, policyReason);
      toast('Advance policy change requested');
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        setAwaitingApproval(true);
        setPolicyOpen(false);
        setPolicyReason('');
        toast(`Sent to ${e.approval.approverRole} · not applied until approved (BR-57)`);
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!vendor) return <Loading what="Loading the vendor file" />;

  const kycColumns: Column<KycItem>[] = [
    { key: 'kind', label: 'Check', render: (r) => r.kind },
    { key: 'value', label: 'Reference', mono: true, render: (r) => r.valueMasked },
    { key: 'route', label: 'Route', render: (r) => <Tag tone="grey">{r.route}</Tag> },
    { key: 'status', label: 'State', render: (r) => <Tag tone={CHECK_TONE[r.status]}>{r.status}</Tag> },
    {
      key: 'by',
      label: 'Verified by',
      render: (r) => (r.verifiedBy ? `${r.verifiedBy} · ${fmtDate(r.verifiedAt)}` : <span className="muted">—</span>),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        can('vendor.verify') && r.status === 'PENDING' ? (
          <button className="btn btn-secondary btn-sm" onClick={() => onVerifyKyc(r.kind)}>
            Verify
          </button>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {r.status === 'VERIFIED' ? '' : 'COMPLIANCE verifies'}
          </span>
        ),
    },
  ];

  const docColumns: Column<VendorDocument>[] = [
    { key: 'kind', label: 'Document', render: (r) => r.kind.replace(/_/g, ' ') },
    { key: 'ref', label: 'Reference', mono: true, render: (r) => r.reference ?? '—' },
    { key: 'valid', label: 'Valid to', render: (r) => fmtDate(r.validTo) },
    { key: 'status', label: 'State', render: (r) => <Tag tone={CHECK_TONE[r.status]}>{r.status}</Tag> },
  ];

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
        sub={`${vendor.code} · ${vendor.baseCity} · ${vendor.constitution.toLowerCase()}`}
        module="vendors"
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
                  <button className="btn btn-secondary btn-sm" onClick={() => setPolicyOpen(true)}>
                    Change
                  </button>
                )}
                {awaitingApproval && <Tag tone="flag">Awaiting approval</Tag>}
              </div>
              <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 0 }}>
                {can('vendor.advance_policy')
                  ? 'Set by compliance and capped on every advance this vendor requests. A change is not applied until it is approved (BR-57).'
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
        {vendor.status === 'ACTIVE' ? (
          <Banner tone="mint" title="Vendor active">
            Cleared by {vendor.verifiedBy ?? 'compliance'} · may be awarded indents on any branch
          </Banner>
        ) : (
          <BlockedPanel
            title="Vendor not yet active"
            subtitle={
              can('vendor.activate')
                ? 'Activation is yours to grant once every item below clears.'
                : 'Compliance clears vendors. Until they do, this vendor cannot be awarded an indent (BR-01).'
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
            note="Activating creates the transporter's portal login and sends the first-login SMS."
          />
        )}

        <Panel title="Trips and business" pad={false}>
          <div className="stat-strip" style={{ border: 0 }}>
            <div>
              <div className="eyebrow">Trips</div>
              <div className="stat-value">{vendor.business.trips}</div>
            </div>
            <div>
              <div className="eyebrow">Revenue</div>
              <div className="stat-value">{inrCompact(vendor.business.revenuePaise)}</div>
            </div>
            <div>
              <div className="eyebrow">Our margin</div>
              <div className="stat-value" style={{ color: 'var(--mint)' }}>
                {inrCompact(vendor.business.marginPaise)}
              </div>
            </div>
            <div>
              <div className="eyebrow">Margin %</div>
              <div className="stat-value">
                {pct(
                  vendor.business.revenuePaise
                    ? (vendor.business.marginPaise / vendor.business.revenuePaise) * 100
                    : 0,
                )}
              </div>
            </div>
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

        <Panel title="Identity checks" pad={false}>
          <DataTable columns={kycColumns} rows={vendor.kyc} rowKey={(r) => r.kind} />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px' }}>
            Aadhaar is held as the last four digits only (BR-04). Identity images are encrypted at rest, visible
            to compliance, and served on 15-minute signed URLs (NFR-04).
          </div>
        </Panel>

        <Panel title="Legal file" pad={false}>
          <DataTable columns={docColumns} rows={vendor.documents} rowKey={(r) => r.kind} />
        </Panel>

        <Panel title="Fleet" pad={false}>
          <DataTable columns={fleetColumns} rows={vendor.fleet} rowKey={(r) => r.registration} empty="No trucks recorded." />
        </Panel>
      </Split>

      <Dialog
        open={confirmActivate}
        title="Clear and activate vendor"
        body="Activating makes this vendor awardable across every branch, creates their portal login and sends the first-login SMS. Compliance is the only role that can do this."
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
        open={policyOpen}
        title="Change the advance policy"
        body="This is not applied when you submit it. It raises an ADVANCE_POLICY_CHANGE approval and takes effect only once a role senior to operations approves (BR-57)."
        confirmLabel="Request change"
        confirmDisabled={policyReason.trim().length < 20}
        busy={busy}
        onConfirm={onPolicySubmit}
        onClose={() => setPolicyOpen(false)}
      >
        <Field label="New advance %" required>
          <select value={policyPct} onChange={(e) => setPolicyPct(Number(e.target.value))}>
            {[0, 40, 70, 90].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason" required hint="At least 20 characters — it is stored on the approval and audited.">
          <textarea rows={3} value={policyReason} onChange={(e) => setPolicyReason(e.target.value)} />
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

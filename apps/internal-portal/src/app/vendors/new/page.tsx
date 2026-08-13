'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError, errorMessage, request } from '@/apis';
import { VENDOR_DOC_KINDS, VENDOR_KYC_KINDS } from '@/lib/documents';
import {
  BlockedPanel,
  Field,
  FormGrid,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { UnmetCondition } from '@/apis';
import { createVendorDraft, patchVendor, submitKyc, submitVendor, uploadVendorDocument } from '../apis';

/**
 * Onboarding wizard — `/vendors/new` · `vendor.edit` (part 03 §1).
 *
 * Five steps, a draft saved per step. Submitting is not activating: the file
 * lands at PENDING_VERIFICATION and compliance clears it (BR-01).
 */

const STEPS = ['Company', 'Identity', 'Fleet', 'Payment', 'Review'] as const;

const companySchema = z.object({
  legalName: z.string().min(2, 'Required'),
  baseCity: z.string().min(2, 'Required'),
  partyType: z.enum(['OWNER', 'VENDOR']),
  gstin: z.string().optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Ten digits, Indian mobile'),
  altPhone: z.string().optional(),
  branchId: z.string().min(1, 'Required'),
});

const fleetSchema = z.object({
  fleetCount: z.number().min(1, 'At least one truck'),
  fleetBase: z.string().min(2, 'Required'),
  operatingStates: z.string().min(2, 'At least one state'),
  bodyType: z.string().optional(),
});

const paymentSchema = z.object({
  bankAccount: z.string().min(6, 'Required'),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks wrong'),
  accountHolder: z.string().min(2, 'Required'),
  advancePct: z.number().min(0).max(100),
});

type CompanyForm = z.infer<typeof companySchema>;
type FleetForm = z.infer<typeof fleetSchema>;
type PaymentForm = z.infer<typeof paymentSchema>;

const BRANCH_OPTIONS = [
  { id: 'br-nsk', name: 'Nashik' },
  { id: 'br-pun', name: 'Pune' },
  { id: 'br-vja', name: 'Vijayawada' },
  { id: 'br-gdm', name: 'Gandhidham' },
  { id: 'br-hsr', name: 'Hosur' },
];

export default function VendorWizardPage() {
  const can = useCan();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [partyType, setPartyType] = useState<'OWNER' | 'VENDOR'>('VENDOR');
  const [kycDone, setKycDone] = useState<Record<string, boolean>>({});
  const [docsDone, setDocsDone] = useState<Record<string, boolean>>({});
  const [unmet, setUnmet] = useState<UnmetCondition[]>([]);
  const [busy, setBusy] = useState(false);

  const company = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: { partyType: 'VENDOR', branchId: 'br-nsk' },
  });
  const fleet = useForm<FleetForm>({ resolver: zodResolver(fleetSchema) });
  const payment = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { advancePct: 40 },
  });

  if (!can('vendor.edit')) {
    return (
      <ModuleGuard module="vendors">
        <PageHeader path="/vendors/new" title="Onboard a vendor" module="vendors" />
        <Panel>Onboarding is a compliance and operations action. You are not able to create a vendor file.</Panel>
      </ModuleGuard>
    );
  }

  /** Step 1 creates the draft; every later step patches it. */
  const saveCompany = company.handleSubmit(async (values) => {
    setBusy(true);
    try {
      setPartyType(values.partyType);
      if (vendorId) await patchVendor(vendorId, values);
      else {
        const created = await createVendorDraft(values);
        setVendorId(created.id);
      }
      toast('Draft saved · branch derived from the base city (BR-34)');
      setStep(1);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const saveFleet = fleet.handleSubmit(async (values) => {
    if (!vendorId) return;
    setBusy(true);
    try {
      await patchVendor(vendorId, {
        fleetCount: values.fleetCount,
        fleetBase: values.fleetBase,
        operatingStates: values.operatingStates.split(',').map((s) => s.trim()),
      });
      setStep(3);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const savePayment = payment.handleSubmit(async (values) => {
    if (!vendorId) return;
    setBusy(true);
    try {
      await patchVendor(vendorId, values);
      toast(`Advance policy set at ${values.advancePct}% — every later change needs approval (BR-57)`);
      setStep(4);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  /** Attachments are uploaded first, then referenced by id (part 01 §7). */
  const attach = async () => {
    const { id } = await request<{ id: string; sha256: string }>({
      url: '/attachments',
      method: 'POST',
      data: { placeholder: true },
    });
    return id;
  };

  const captureKyc = async (kind: string, value: string) => {
    if (!vendorId) return;
    try {
      const attachmentId = await attach();
      await submitKyc(vendorId, kind, { value, route: 'MANUAL', attachmentId });
      setKycDone((d) => ({ ...d, [kind]: true }));
      toast(`${kind} captured · queued for compliance`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const captureDoc = async (kind: string, reference: string) => {
    if (!vendorId) return;
    try {
      const attachmentId = await attach();
      await uploadVendorDocument(vendorId, kind, { attachmentId, reference });
      setDocsDone((d) => ({ ...d, [kind]: true }));
      toast(`${kind.replace(/_/g, ' ')} uploaded`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const onSubmitFile = async () => {
    if (!vendorId) return;
    setBusy(true);
    setUnmet([]);
    try {
      const vendor = await submitVendor(vendorId);
      toast('Submitted for verification — submitting is not activating');
      router.push(`/vendors/${vendor.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VENDOR_INCOMPLETE') setUnmet(e.unmet);
      else toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/new"
        title="Onboard a vendor"
        sub="Five steps, saved as a draft at each one. Submitting sends the file to compliance; it does not activate it."
        module="vendors"
      />

      <Stack>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={i <= step ? '' : 'muted'}
              style={{
                padding: '7px 12px',
                fontSize: 12.5,
                border: '1px solid var(--color-divider)',
                background: i === step ? 'var(--color-accent)' : 'var(--color-surface)',
                color: i === step ? '#F0F3F8' : undefined,
              }}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <Panel title="1 · Company">
            <FormGrid>
              <Field label="Legal name" required error={company.formState.errors.legalName?.message}>
                <input {...company.register('legalName')} />
              </Field>
              <Field label="Base city" required error={company.formState.errors.baseCity?.message}>
                <input {...company.register('baseCity')} />
              </Field>
              <Field label="Party type" required hint="An Owner must have an RC on file (BR-02).">
                <select {...company.register('partyType')}>
                  <option value="VENDOR">Vendor</option>
                  <option value="OWNER">Owner</option>
                </select>
              </Field>
              <Field
                label="Branch"
                required
                hint="Derived from the base city within 150 km (BR-34). Two in range → leadership override (BR-47)."
              >
                <select {...company.register('branchId')}>
                  {BRANCH_OPTIONS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="GSTIN" hint="Checked against GSTN where present — advisory, never blocking.">
                <input {...company.register('gstin')} />
              </Field>
              <Field label="Phone" required error={company.formState.errors.phone?.message}>
                <input {...company.register('phone')} />
              </Field>
              <Field label="Alternate phone">
                <input {...company.register('altPhone')} />
              </Field>
            </FormGrid>
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={saveCompany} disabled={busy}>
                Save and continue
              </button>
            </div>
          </Panel>
        )}

        {step === 1 && (
          <Panel title="2 · Identity and legal file">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              The geo-stamped selfie is our executive standing with the transporter at their yard — captured here
              by an internal user, never by the transporter. Aadhaar is stored as the last four digits only.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {VENDOR_KYC_KINDS.map((k) => (
                <CaptureRow
                  key={k.kind}
                  label={k.label}
                  done={!!kycDone[k.kind]}
                  placeholder={k.kind === 'AADHAAR' ? 'Last four digits' : 'Reference'}
                  onCapture={(value) => captureKyc(k.kind, value)}
                />
              ))}
              {VENDOR_DOC_KINDS.filter(
                (d) => partyType === 'OWNER' || d.kind !== 'RC',
              ).map((d) => (
                <CaptureRow
                  key={d.kind}
                  label={d.label}
                  note={d.note}
                  done={!!docsDone[d.kind]}
                  placeholder="Reference or number"
                  onCapture={(value) => captureDoc(d.kind, value)}
                />
              ))}
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel title="3 · Fleet">
            <FormGrid>
              <Field label="Trucks" required error={fleet.formState.errors.fleetCount?.message}>
                <input type="number" {...fleet.register('fleetCount', { valueAsNumber: true })} />
              </Field>
              <Field label="Fleet base" required error={fleet.formState.errors.fleetBase?.message}>
                <input {...fleet.register('fleetBase')} />
              </Field>
              <Field
                label="Operating states"
                required
                hint="Comma separated — drives which loads they are notified about."
                error={fleet.formState.errors.operatingStates?.message}
              >
                <input placeholder="MH, GJ, MP" {...fleet.register('operatingStates')} />
              </Field>
              <Field label="Body type">
                <input {...fleet.register('bodyType')} />
              </Field>
            </FormGrid>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn" onClick={saveFleet} disabled={busy}>
                Save and continue
              </button>
            </div>
          </Panel>
        )}

        {step === 3 && (
          <Panel title="4 · Payment">
            <FormGrid>
              <Field label="Account number" required error={payment.formState.errors.bankAccount?.message}>
                <input {...payment.register('bankAccount')} />
              </Field>
              <Field label="IFSC" required error={payment.formState.errors.ifsc?.message}>
                <input {...payment.register('ifsc')} />
              </Field>
              <Field label="Account holder" required error={payment.formState.errors.accountHolder?.message}>
                <input {...payment.register('accountHolder')} />
              </Field>
              <Field
                label="Advance policy %"
                required
                hint="Becomes this vendor's default on every indent (BR-30). Later changes need approval (BR-57)."
              >
                <select {...payment.register('advancePct', { valueAsNumber: true })}>
                  {[0, 40, 70, 90].map((p) => (
                    <option key={p} value={p}>
                      {p}%
                    </option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="btn" onClick={savePayment} disabled={busy}>
                Save and continue
              </button>
            </div>
          </Panel>
        )}

        {step === 4 && (
          <Stack>
            {unmet.length > 0 && (
              <BlockedPanel
                title="This file cannot be submitted yet"
                unmet={unmet}
                note="BR-02 requires an RC for an Owner; BR-03 requires a TDS declaration from every transporter, whatever the party type."
              />
            )}
            <Panel title="5 · Review and submit">
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                Submitting moves the file to <strong>PENDING_VERIFICATION</strong>. Compliance verifies each item
                and only they can activate — an incomplete file cannot be activated by any route, including
                import (BR-01).
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.keys(kycDone).map((k) => (
                  <Tag key={k} tone="mint">
                    {k} captured
                  </Tag>
                ))}
                {Object.keys(docsDone).map((k) => (
                  <Tag key={k} tone="mint">
                    {k.replace(/_/g, ' ')}
                  </Tag>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setStep(3)}>
                  Back
                </button>
                <button className="btn" onClick={onSubmitFile} disabled={busy || !vendorId}>
                  Submit for verification
                </button>
              </div>
            </Panel>
          </Stack>
        )}
      </Stack>
    </ModuleGuard>
  );
}

function CaptureRow({
  label,
  note,
  placeholder,
  done,
  onCapture,
}: {
  label: string;
  note?: string;
  placeholder: string;
  done: boolean;
  onCapture: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div
      className="surface"
      style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', flexWrap: 'wrap' }}
    >
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ fontSize: 13 }}>{label}</div>
        {note && (
          <div className="muted" style={{ fontSize: 11.5 }}>
            {note}
          </div>
        )}
      </div>
      <input
        style={{ flex: '0 1 220px', padding: '7px 9px', border: '1px solid var(--color-divider)', fontFamily: 'inherit' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={done}
      />
      {done ? (
        <Tag tone="mint">Captured</Tag>
      ) : (
        <button className="btn btn-secondary btn-sm" disabled={!value.trim()} onClick={() => onCapture(value)}>
          Capture
        </button>
      )}
    </div>
  );
}

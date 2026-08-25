'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError, errorMessage, request } from '@/apis';
import { GOVERNMENT_CERTIFICATE_KINDS, VENDOR_DOC_KINDS, VENDOR_KYC_KINDS, docLabel } from '@/lib/documents';
import { capitalizeWords } from '@/lib/format';
import { INDIAN_STATES } from '@/lib/geo';
import { checkGstin } from '@/lib/gstin';
import { IfscLookupResult, lookupIfsc } from '@/lib/ifsc';
import { TRUCK_TYPES } from '@/lib/vehicles';
import {
  Banner,
  BlockedPanel,
  CityField,
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
import {
  createVendorDraft,
  listBranches,
  listLeads,
  patchVendor,
  submitKyc,
  submitVendor,
  uploadVendorDocument,
} from '../apis';
import type { Lead } from '../types';
import type { Branch } from '@/app/admin/branches/types';

/**
 * Onboarding wizard — `/vendors/new` · `vendor.edit` (part 03 §1).
 *
 * Five steps, a draft saved per step. Submitting is not activating: the file
 * lands at PENDING_VERIFICATION and compliance clears it (BR-01).
 */

const STEPS = ['Company', 'Identity', 'Fleet', 'Payment', 'Review'] as const;

/** The same friendly label step 2 showed, so the review list does not go shouty. */
function kycLabel(kind: string): string {
  return VENDOR_KYC_KINDS.find((k) => k.kind === kind)?.label ?? docLabel(kind);
}

function vendorDocLabel(kind: string): string {
  return (
    VENDOR_DOC_KINDS.find((d) => d.kind === kind)?.label ??
    GOVERNMENT_CERTIFICATE_KINDS.find((g) => g.kind === kind)?.label ??
    docLabel(kind)
  );
}

const PHONE_RE = /^[6-9]\d{9}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const AADHAAR_LAST4_RE = /^\d{4}$/;

/** How the operator's raw keystrokes become the stored value for each KYC kind. */
const KYC_NORMALIZE: Record<string, (value: string) => string> = {
  PAN: (v) => v.toUpperCase().slice(0, 10),
  AADHAAR: (v) => v.replace(/\D/g, '').slice(0, 4),
};

const KYC_VALIDATE: Record<string, (value: string) => string | undefined> = {
  PAN: (v) => (PAN_RE.test(v) ? undefined : 'PAN looks wrong, e.g. AAKCR2148L'),
  AADHAAR: (v) => (AADHAAR_LAST4_RE.test(v) ? undefined : 'Enter the last four digits only'),
};

const companySchema = z.object({
  legalName: z.string().min(2, 'Required').transform((v) => capitalizeWords(v)),
  baseCity: z.string().min(2, 'Required').transform((v) => capitalizeWords(v)),
  partyType: z.enum(['OWNER', 'VENDOR']),
  // Advisory only (checked against GSTN, never blocking) — normalized to
  // uppercase but not format-gated, so a malformed value still saves.
  gstin: z
    .string()
    .transform((v) => v.toUpperCase())
    .optional(),
  phone: z.string().regex(PHONE_RE, 'Ten digits, Indian mobile'),
  altPhone: z
    .string()
    .optional()
    .refine((v) => !v || PHONE_RE.test(v), 'Ten digits, Indian mobile'),
  branchId: z.string().min(1, 'Required'),
});

const fleetSchema = z.object({
  fleetCount: z.number().min(1, 'At least one truck'),
  truckTypes: z.array(z.string()).min(1, 'Add at least one truck type'),
  operatingStates: z.array(z.string()).min(1, 'At least one state'),
  bodyType: z
    .string()
    .transform((v) => (v ? capitalizeWords(v) : v))
    .optional(),
});

const paymentSchema = z.object({
  bankAccount: z.string().min(6, 'Required'),
  ifsc: z
    .string()
    .min(1, 'Required')
    .transform((v) => v.toUpperCase())
    .refine((v) => IFSC_RE.test(v), 'IFSC looks wrong'),
  accountHolder: z.string().min(2, 'Required').transform((v) => capitalizeWords(v)),
  advancePct: z.number().min(0).max(100),
});

type CompanyForm = z.infer<typeof companySchema>;
type FleetForm = z.infer<typeof fleetSchema>;
type PaymentForm = z.infer<typeof paymentSchema>;

/** Every new vendor starts at this advance policy — compliance can change it later (BR-57). */
const DEFAULT_ADVANCE_PCT = 80;

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
  const [branches, setBranches] = useState<Branch[]>([]);
  /** The lead this form was opened from, when it came off the leads list. */
  const [lead, setLead] = useState<Lead | null>(null);
  /** Anything about that lead the operator has to know and act on by hand. */
  const [leadNote, setLeadNote] = useState<string | null>(null);

  useEffect(() => {
    listBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  const company = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: { partyType: 'VENDOR', branchId: 'br-nsk' },
  });
  const fleet = useForm<FleetForm>({
    resolver: zodResolver(fleetSchema),
    defaultValues: { truckTypes: [] },
  });
  const payment = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { advancePct: DEFAULT_ADVANCE_PCT },
  });
  const gstinValue = company.watch('gstin');
  const ifscValue = payment.watch('ifsc');
  const ifscLookup = useIfscLookup(ifscValue, IFSC_RE);
  const truckTypes = fleet.watch('truckTypes') ?? [];

  /**
   * Opened from a lead (`/vendors/new?lead=…`)? Fill in what business
   * development already wrote down, so nobody keys the same name, city and
   * phone number a second time.
   *
   * The parameter is read off `window.location` rather than through
   * `useSearchParams`, which would force this whole page behind a Suspense
   * boundary at build time for one optional string. There is no
   * `GET /vendors/leads/:id`, so the row is picked out of the list.
   */
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get('lead');
    if (!leadId) return;
    let live = true;
    listLeads()
      .then((leads) => {
        if (!live) return;
        const found = leads.find((l) => l.id === leadId);
        if (!found) {
          setLeadNote(
            'This form was opened from a lead we cannot find any more, so nothing has been filled in. Check the leads list before you carry on.',
          );
          return;
        }
        setLead(found);
        company.setValue('legalName', found.name);
        company.setValue('baseCity', found.city);
        company.setValue('phone', found.phone);
        company.setValue('partyType', found.partyType);
        setPartyType(found.partyType);
        if (found.trucksClaimed > 0) fleet.setValue('fleetCount', found.trucksClaimed);
      })
      .catch((e) => {
        if (!live) return;
        setLeadNote(
          `We could not open the lead this form came from — ${errorMessage(e)}. Nothing has been filled in; key the details in by hand.`,
        );
      });
    return () => {
      live = false;
    };
    // Runs once on mount; the form objects are stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!can('vendor.edit')) {
    return (
      <ModuleGuard module="vendors">
        <PageHeader path="/vendors/new" title="Add a transporter" module="vendors" />
        <Panel>Onboarding is a compliance and operations action. You are not able to create a vendor file.</Panel>
      </ModuleGuard>
    );
  }

  /**
   * Creates the draft, carrying the lead along with it when there is one.
   *
   * `leadId` rides in the same call as the vendor on purpose: the server
   * closes the lead inside the insert's own transaction, so the two can never
   * come apart — there is no moment where the transporter exists and the lead
   * is still sitting at Qualified for somebody to work again next week.
   *
   * That leaves exactly two things this can come back with, and both are said
   * in words on screen rather than swallowed: somebody already converted this
   * lead, or the lead is no longer there.
   */
  const createDraftFromLead = async (values: CompanyForm) => {
    if (!lead) return createVendorDraft(values);
    try {
      const created = await createVendorDraft({ ...values, leadId: lead.id });
      setLead({
        ...lead,
        stage: 'CONVERTED',
        convertedVendorId: created.id,
        convertedVendorCode: created.code,
        convertedVendorName: created.legalName,
      });
      setLeadNote(null);
      return created;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LEAD_ALREADY_CONVERTED') {
        // Nothing was created. Clearing the lead keeps this form usable, but
        // the words steer them at the transporter that already exists.
        setLead(null);
        setLeadNote(
          `${lead.name} has already been turned into a transporter — somebody got there first, and nothing has been created here. ` +
            'Search the transporter list for them before you add a second file for the same firm.',
        );
        throw e;
      }
      // The only 404 a create can raise is the lead we just sent, and a
      // vanished lead is no reason to make somebody key the form again.
      if (e instanceof ApiError && e.status === 404) {
        setLead(null);
        setLeadNote(
          'The lead this form was opened from is no longer there, so the transporter has been created on its own. Everything you had keyed in was kept.',
        );
        return createVendorDraft(values);
      }
      throw e;
    }
  };

  /** Step 1 creates the draft; every later step patches it. */
  const saveCompany = company.handleSubmit(async (values) => {
    setBusy(true);
    try {
      setPartyType(values.partyType);
      if (vendorId) await patchVendor(vendorId, values);
      else {
        const created = await createDraftFromLead(values);
        setVendorId(created.id);
      }
      toast('Draft saved · branch worked out from the base city');
      setStep(1);
    } catch (e) {
      // An already-converted lead has just said so, at length, in a banner —
      // a toast repeating the server's one-liner would only talk over it.
      if (!(e instanceof ApiError && e.code === 'LEAD_ALREADY_CONVERTED')) toast(errorMessage(e));
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
        truckTypes: values.truckTypes,
        operatingStates: values.operatingStates,
        // The form has always asked for this; the payload used to drop it, so
        // whatever the operator typed vanished the moment they hit save.
        bodyType: values.bodyType,
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
      toast(`Advance policy set at ${values.advancePct}% — every later change needs approval`);
      setStep(4);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  /**
   * Attachments are uploaded first, then referenced by id (part 01 §7).
   * `POST /attachments` is `multipart/form-data` with field `file` — axios
   * sets the boundary itself once it sees a FormData body, so the request
   * must not force a JSON Content-Type.
   */
  const attach = async (
    file: File,
    meta: {
      kind?: string;
      entityType?: string;
      entityId?: string;
      latitude?: number;
      longitude?: number;
    } = {},
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (meta.kind) formData.append('kind', meta.kind);
    if (meta.entityType) formData.append('entityType', meta.entityType);
    if (meta.entityId) formData.append('entityId', meta.entityId);
    if (meta.latitude !== undefined) formData.append('latitude', String(meta.latitude));
    if (meta.longitude !== undefined) formData.append('longitude', String(meta.longitude));
    const { id } = await request<{ id: string; sha256: string }>({
      url: '/attachments',
      method: 'POST',
      data: formData,
    });
    return id;
  };

  const captureKyc = async (
    kind: string,
    value: string,
    file: File,
    geo?: { latitude: number; longitude: number },
  ) => {
    if (!vendorId) return;
    try {
      const attachmentId = await attach(file, {
        kind,
        entityType: 'vendor',
        entityId: vendorId,
        latitude: geo?.latitude,
        longitude: geo?.longitude,
      });
      await submitKyc(vendorId, kind, { value, route: 'MANUAL', attachmentId });
      setKycDone((d) => ({ ...d, [kind]: true }));
      toast(`${kind} captured · queued for compliance`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const captureDoc = async (kind: string, reference: string, file: File) => {
    if (!vendorId) return;
    try {
      const attachmentId = await attach(file, { kind, entityType: 'vendor', entityId: vendorId });
      await uploadVendorDocument(vendorId, kind, { attachmentId, ...(reference ? { reference } : {}) });
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
        title="Add a transporter"
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
                borderRadius: 'var(--radius-sm)',
                background: i === step ? 'var(--color-accent)' : 'var(--color-surface)',
                color: i === step ? 'var(--color-bg)' : undefined,
              }}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>

        {/*
          Nobody should meet a half-filled form and have to guess where the
          words came from. This says which lead, who wrote it down, and that
          the leads list closes itself when the file is created.
        */}
        {lead && (
          <Banner
            tone="blue"
            emoji="🤝"
            title={`Filled in from the lead for ${lead.name}`}
            right={
              <a className="btn btn-secondary btn-sm" href="/vendors/leads">
                See the lead
              </a>
            }
          >
            {lead.code} · {lead.city} · came to us{' '}
            {lead.source === 'REFERRAL'
              ? 'as a referral'
              : lead.source === 'FIELD'
                ? 'through one of our people'
                : 'from a lane we cannot cover'}
            . Check every line against the transporter before you save —{' '}
            {lead.stage === 'CONVERTED'
              ? 'the lead is now marked converted.'
              : 'saving this step marks the lead converted, so nobody works it twice.'}
          </Banner>
        )}

        {leadNote && (
          <Banner tone="flag" title="About the lead this came from">
            {leadNote}
          </Banner>
        )}

        {step === 0 && (
          <Panel title="1 · Company">
            <FormGrid>
              <Field label="Legal name" required error={company.formState.errors.legalName?.message}>
                <input
                  {...company.register('legalName')}
                  onBlur={(e) => company.setValue('legalName', capitalizeWords(e.target.value))}
                />
              </Field>
              <Field label="Base city" required error={company.formState.errors.baseCity?.message}>
                <CityField
                  listId="cities-base-city"
                  {...company.register('baseCity')}
                  onBlur={(e) => company.setValue('baseCity', capitalizeWords(e.target.value))}
                />
              </Field>
              <Field label="Party type" required hint="An Owner must have a Registration Certificate (RC) on file.">
                <select {...company.register('partyType')}>
                  <option value="VENDOR">Vendor</option>
                  <option value="OWNER">Owner</option>
                </select>
              </Field>
              <Field
                label="Branch"
                required
                hint="Picked automatically: the branch within 150 km of the base city. If two branches are in range, leadership decides which one."
              >
                <select {...company.register('branchId')}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="GSTIN"
                hint={
                  gstinValue && !checkGstin(gstinValue).valid
                    ? `${checkGstin(gstinValue).reason} Checked against GSTN, but this will not block saving.`
                    : 'Checked against GSTN where present — advisory, never blocking.'
                }
              >
                <input
                  {...company.register('gstin')}
                  onBlur={(e) => company.setValue('gstin', e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Phone" required error={company.formState.errors.phone?.message}>
                <input {...company.register('phone')} />
              </Field>
              <Field label="Alternate phone" error={company.formState.errors.altPhone?.message}>
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
                  note={k.note}
                  done={!!kycDone[k.kind]}
                  placeholder={
                    k.kind === 'AADHAAR' ? 'Last four digits' : k.kind === 'PAN' ? 'PAN number' : 'Reference'
                  }
                  needsReference={k.needsReference !== false}
                  normalize={KYC_NORMALIZE[k.kind]}
                  validate={KYC_VALIDATE[k.kind]}
                  useCamera={k.kind === 'SELFIE'}
                  requireGeotag={k.kind === 'SELFIE'}
                  onCapture={(value, file, geo) => captureKyc(k.kind, value, file, geo)}
                />
              ))}
              <GovCertRow
                options={GOVERNMENT_CERTIFICATE_KINDS}
                done={GOVERNMENT_CERTIFICATE_KINDS.some((o) => docsDone[o.kind])}
                onCapture={(kind, file) => captureDoc(kind, '', file)}
              />
              {VENDOR_DOC_KINDS.filter(
                (d) =>
                  (partyType === 'OWNER' || d.kind !== 'RC') &&
                  !GOVERNMENT_CERTIFICATE_KINDS.some((g) => g.kind === d.kind),
              ).map((d) => (
                <CaptureRow
                  key={d.kind}
                  label={d.label}
                  note={d.note}
                  done={!!docsDone[d.kind]}
                  placeholder="Reference or number"
                  needsReference={d.needsReference !== false}
                  onCapture={(value, file) => captureDoc(d.kind, value, file)}
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
              <Field
                label="Truck types"
                required
                hint="Add every truck type this vendor runs — shown on their fleet summary."
                error={fleet.formState.errors.truckTypes?.message}
              >
                <TruckTypeField
                  value={truckTypes}
                  onChange={(v) => fleet.setValue('truckTypes', v, { shouldValidate: true })}
                />
              </Field>
              <Field
                label="Operating states"
                required
                hint="Hold Ctrl (Cmd on Mac) to select more than one — drives which loads they are notified about."
                error={fleet.formState.errors.operatingStates?.message}
              >
                <select multiple size={6} {...fleet.register('operatingStates')}>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Body type">
                <input
                  {...fleet.register('bodyType')}
                  onBlur={(e) => fleet.setValue('bodyType', capitalizeWords(e.target.value))}
                />
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
                <input
                  {...payment.register('ifsc')}
                  onBlur={(e) => payment.setValue('ifsc', e.target.value.toUpperCase())}
                />
                <IfscLookupHint result={ifscLookup} />
              </Field>
              <Field label="Account holder" required error={payment.formState.errors.accountHolder?.message}>
                <input
                  {...payment.register('accountHolder')}
                  onBlur={(e) => payment.setValue('accountHolder', capitalizeWords(e.target.value))}
                />
              </Field>
              <input type="hidden" {...payment.register('advancePct', { valueAsNumber: true })} />
            </FormGrid>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Advance policy opens at {DEFAULT_ADVANCE_PCT}% for every new vendor. Compliance can raise or lower
              it later from the vendor file, and that change needs approval.
            </p>
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
                note="An Owner needs a Registration Certificate (RC) on file, and every transporter needs a signed TDS declaration."
              />
            )}
            <Panel title="5 · Review and submit">
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                Submitting moves the file to <strong>Pending verification</strong>. Compliance verifies each item
                and only they can activate — an incomplete file can never be activated, not even by a bulk
                import.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.keys(kycDone).map((k) => (
                  <Tag key={k} tone="mint">
                    {kycLabel(k)} captured
                  </Tag>
                ))}
                {Object.keys(docsDone).map((k) => (
                  <Tag key={k} tone="mint">
                    {vendorDocLabel(k)}
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
  normalize,
  validate,
  useCamera = false,
  requireGeotag = false,
  needsReference = true,
}: {
  label: string;
  note?: string;
  placeholder: string;
  done: boolean;
  onCapture: (value: string, file: File, geo?: { latitude: number; longitude: number }) => void | Promise<void>;
  normalize?: (value: string) => string;
  validate?: (value: string) => string | undefined;
  useCamera?: boolean;
  requireGeotag?: boolean;
  /** `false` — document upload only, no typed reference/number field. */
  needsReference?: boolean;
}) {
  const [value, setValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const handleValueChange = (raw: string) => {
    const next = normalize ? normalize(raw) : raw;
    setValue(next);
    setError(validate ? validate(next) : undefined);
  };

  const canCapture = needsReference ? !!value.trim() && !error && !!file : !!file;

  /** Best-effort — a denied or unsupported geolocation prompt never blocks the capture. */
  const captureGeo = () =>
    new Promise<{ latitude: number; longitude: number } | undefined>((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(undefined);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(undefined),
        { timeout: 8000 },
      );
    });

  const handleCapture = async () => {
    if (!canCapture || !file || busy) return;
    setBusy(true);
    try {
      const geo = requireGeotag ? await captureGeo() : undefined;
      await onCapture(needsReference ? value.trim() : '', file, geo);
    } finally {
      setBusy(false);
    }
  };

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
      {needsReference && (
        <input
          style={{
            flex: '0 1 220px',
            padding: '7px 9px',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'inherit',
          }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          disabled={done || busy}
        />
      )}
      {!done && (
        <input
          type="file"
          accept={useCamera ? 'image/*' : 'image/*,application/pdf'}
          capture={useCamera ? 'environment' : undefined}
          style={{ flex: '0 1 180px', fontSize: 11.5 }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      )}
      {error && needsReference && <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</span>}
      {done ? (
        <Tag tone="mint">Captured</Tag>
      ) : (
        <button className="btn btn-secondary btn-sm" disabled={!canCapture || busy} onClick={handleCapture}>
          {busy ? 'Capturing…' : 'Capture'}
        </button>
      )}
    </div>
  );
}

/** The single "Government certificate" row — one dropdown of which kind, uploaded under that specific kind. */
function GovCertRow({
  options,
  done,
  onCapture,
}: {
  options: { kind: string; label: string }[];
  done: boolean;
  onCapture: (kind: string, file: File) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState(options[0]?.kind ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const canCapture = !!selected && !!file;

  const handleCapture = async () => {
    if (!canCapture || !file || busy) return;
    setBusy(true);
    try {
      await onCapture(selected, file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="surface"
      style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', flexWrap: 'wrap' }}
    >
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ fontSize: 13 }}>Government certificate</div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          Trade licence, Labour licence or Udyam / MSME — mandatory, whichever applies
        </div>
      </div>
      {!done && (
        <select
          style={{
            flex: '0 1 220px',
            padding: '7px 9px',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'inherit',
          }}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy}
        >
          {options.map((o) => (
            <option key={o.kind} value={o.kind}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {!done && (
        <input
          type="file"
          accept="image/*,application/pdf"
          style={{ flex: '0 1 180px', fontSize: 11.5 }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      )}
      {done ? (
        <Tag tone="mint">Captured</Tag>
      ) : (
        <button className="btn btn-secondary btn-sm" disabled={!canCapture || busy} onClick={handleCapture}>
          {busy ? 'Capturing…' : 'Capture'}
        </button>
      )}
    </div>
  );
}

/** Add-multiple control for the Fleet step — pick a truck type, add it, remove with the × on its tag. */
function TruckTypeField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [pick, setPick] = useState<string>(TRUCK_TYPES[0]);

  const add = () => {
    if (!pick || value.includes(pick)) return;
    onChange([...value, pick]);
  };
  const remove = (t: string) => onChange(value.filter((v) => v !== t));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1 }}>
          {TRUCK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={add}>
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.map((t) => (
            <Tag key={t} tone="grey">
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label={`Remove ${t}`}
                style={{
                  marginLeft: 6,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                  padding: 0,
                }}
              >
                ×
              </button>
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Debounced live IFSC → bank/branch lookup (`lib/ifsc.ts`) — a free, keyless
 * public API, not our own backend. Only fires once the value already
 * matches the IFSC shape, so it never spends a network round trip on a
 * half-typed code. Advisory: the caller decides what to show, this hook
 * never blocks or validates on its own account.
 */
function useIfscLookup(value: string | undefined, shapeRe: RegExp): IfscLookupResult | null {
  const [result, setResult] = useState<IfscLookupResult | null>(null);

  useEffect(() => {
    const code = (value ?? '').toUpperCase();
    if (!shapeRe.test(code)) {
      setResult(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookupIfsc(code, controller.signal)
        .then(setResult)
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setResult({ status: 'error', message: 'Could not reach the bank lookup service.' });
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, shapeRe]);

  return result;
}

/** What the operator sees under the IFSC field while/after a lookup runs. */
function IfscLookupHint({ result }: { result: IfscLookupResult | null }) {
  if (!result) return null;

  if (result.status === 'found') {
    return (
      <span style={{ fontSize: 11, color: 'var(--mint)' }}>
        ✓ {result.branch.bank} — {result.branch.branch}, {result.branch.city}
      </span>
    );
  }
  if (result.status === 'not_found') {
    return (
      <span style={{ fontSize: 11, color: 'var(--red)' }}>
        No branch found for this IFSC — double-check it. This will not block saving.
      </span>
    );
  }
  return (
    <span className="muted" style={{ fontSize: 11 }}>
      Bank lookup unavailable right now ({result.message}) — saving is unaffected.
    </span>
  );
}

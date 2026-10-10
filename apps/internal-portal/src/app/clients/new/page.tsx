'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { errorMessage } from '@/apis';
import { uploadAttachment } from '@/lib/attachments';
import { capitalizeWords } from '@/lib/format';
import { checkGstin } from '@/lib/gstin';
import {
  CityField,
  EmptyState,
  Field,
  FormGrid,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  useCan,
  useLevel,
  useToast,
} from '@/lib/ui';
import { createClient } from '../apis';
import { submitClientDocument } from '../onboarding/apis';
import type { ClientDocumentKind } from '../onboarding/types';

/**
 * The papers Compliance checks before a client can be given loads — the same
 * list Client verification works through. A spot client has no rate contract
 * to sign, so it is not asked for one.
 */
const PAPERS: { kind: ClientDocumentKind; label: string; hint: string; contractOnly?: boolean }[] = [
  { kind: 'GST_CERTIFICATE', label: 'GST certificate', hint: 'Their GST registration certificate.' },
  { kind: 'PAN', label: 'PAN card', hint: 'The company’s PAN card.' },
  { kind: 'CREDIT_CHECK', label: 'Credit and credibility check', hint: 'The credit report, or what was found about them.' },
  { kind: 'SIGNED_AGREEMENT', label: 'Signed rate agreement', hint: 'The agreement signed by both sides.', contractOnly: true },
];

/** The server refuses anything larger, so say so before sending it. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const schema = z
  .object({
    name: z.string().min(2, 'Enter the company name as it appears on their invoices'),
    billingCity: z
      .string()
      .min(2, 'Enter the city we raise invoices to')
      .transform((v) => capitalizeWords(v)),
    // Printed under the client's name on every invoice we raise them.
    billingAddress: z.string().trim().min(5, 'Enter the address their invoices go to'),
    billingState: z
      .string()
      .trim()
      .min(2, 'Enter the state')
      .transform((v) => capitalizeWords(v)),
    billingPincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter the 6-digit PIN code'),
    // Advisory only (checked against GSTN, never blocking) — normalized to
    // uppercase but not format-gated, so a malformed value still saves.
    gstin: z
      .string()
      .transform((v) => v.toUpperCase())
      .optional(),
    contact: z.string().min(2, 'Enter the name of the person we deal with'),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    email: z.string().email('Enter a valid email, e.g. accounts@company.com'),
    engagement: z.enum(['SPOT', 'CONTRACT']),
    agreementNo: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    creditDays: z.number().min(0).max(180),
    serviceLevel: z.string().min(2, 'Say what we commit to, e.g. Next day placement'),
  })
  .refine((v) => v.engagement !== 'CONTRACT' || !!v.agreementNo, {
    message: 'A contract client needs an agreement number',
    path: ['agreementNo'],
  });

type Form = z.infer<typeof schema>;

/** New client — one scrolling form: company and billing → agreement → credit and service. */
export default function NewClientPage() {
  const router = useRouter();
  const toast = useToast();
  const level = useLevel('clients');
  const can = useCan();
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { engagement: 'CONTRACT', creditDays: 45, serviceLevel: 'Next day placement' },
  });

  const engagement = form.watch('engagement');
  const gstinValue = form.watch('gstin');

  // The files chosen for each paper. They are sent once the client exists.
  const [files, setFiles] = useState<Partial<Record<ClientDocumentKind, File>>>({});
  const papers = PAPERS.filter((p) => !p.contractOnly || engagement === 'CONTRACT');
  const chooseFile = (kind: ClientDocumentKind, file: File | undefined) => {
    if (file && file.size > MAX_UPLOAD_BYTES) {
      toast('That file is larger than 10 MB — choose a smaller scan or photo.');
      return;
    }
    setFiles((f) => {
      const next = { ...f };
      if (file) next[kind] = file;
      else delete next[kind];
      return next;
    });
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const client = await createClient(values);
      // Each paper goes up against the new client and waits for Compliance to
      // check it. One that fails to send does not undo the client: it is named,
      // and can be uploaded again from Client verification.
      const failed: string[] = [];
      for (const paper of papers) {
        const file = files[paper.kind];
        if (!file) continue;
        try {
          const attachmentId = await uploadAttachment(file, paper.kind, 'clients', client.id);
          await submitClientDocument(client.id, { kind: paper.kind, attachmentId, reference: file.name });
        } catch {
          failed.push(paper.label);
        }
      }
      const sent = papers.filter((p) => files[p.kind]).length - failed.length;
      toast(
        failed.length > 0
          ? `${client.code} · ${values.name} added, but these could not be uploaded: ${failed.join(', ')}. Upload them from Client verification.`
          : sent > 0
            ? `${client.code} · ${values.name} added with ${sent} ${sent === 1 ? 'document' : 'documents'}`
            : `${client.code} · ${values.name} added`,
      );
      router.push(`/clients/${client.id}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  });

  // `client.manage`, not module EDIT — see clients/page.tsx.
  if (level !== 'EDIT' || !can('client.manage')) {
    return (
      <ModuleGuard module="clients">
        <PageHeader path="/clients/new" title="New client" module="clients" />
        <PageIntro
          what="Set up a company that will ship with us — who we bill, who to call, how they are priced, and how long they get to pay."
          who="Finance sets up clients."
        />
        <Panel pad={false}>
          <EmptyState
            title="Only Finance can add a client"
            hint="You can still open any existing client and see their contacts, credit terms and agreed lane prices. Ask Finance to set up a new one."
            action={
              <Link href="/clients" className="btn btn-secondary">
                Back to clients
              </Link>
            }
          />
        </Panel>
      </ModuleGuard>
    );
  }

  return (
    <ModuleGuard module="clients">
      <PageHeader path="/clients/new" title="New client" module="clients" />
      <PageIntro
        what="Set up a company that will ship with us — who we bill, who to call, how they are priced, and how long they get to pay."
        who="Finance sets up clients."
      >
        Lane prices are not entered here. They arrive on their own once we win a quote (RFQ) for this client.
      </PageIntro>
      <Stack>
        <Panel title="Company and billing">
          <FormGrid>
            <Field
              label="Company name"
              required
              error={form.formState.errors.name?.message}
              hint="As it appears on their invoices."
            >
              <input {...form.register('name')} />
            </Field>
            <Field
              label="Billing city"
              required
              error={form.formState.errors.billingCity?.message}
              hint="Where we raise their invoices."
            >
              <CityField
                listId="cities-billing-city"
                {...form.register('billingCity')}
                onBlur={(e) => form.setValue('billingCity', capitalizeWords(e.target.value))}
              />
            </Field>
            <Field
              label="Billing address"
              required
              error={form.formState.errors.billingAddress?.message}
              hint="Door number, street and area. Printed under their name on every invoice."
            >
              <input {...form.register('billingAddress')} placeholder="e.g. Plot 14, APIIC Industrial Park, Atchutapuram" />
            </Field>
            <Field label="State" required error={form.formState.errors.billingState?.message}>
              <input
                {...form.register('billingState')}
                placeholder="e.g. Andhra Pradesh"
                onBlur={(e) => form.setValue('billingState', capitalizeWords(e.target.value))}
              />
            </Field>
            <Field label="PIN code" required error={form.formState.errors.billingPincode?.message}>
              <input {...form.register('billingPincode')} inputMode="numeric" maxLength={6} placeholder="e.g. 531011" />
            </Field>
            <Field
              label="GSTIN (tax number)"
              hint={
                gstinValue && !checkGstin(gstinValue).valid
                  ? `${checkGstin(gstinValue).reason} You can still save — this is a warning, not a block.`
                  : "The client's 15-character GST number, as printed on their invoices. We only check that it looks right."
              }
            >
              <input
                {...form.register('gstin')}
                onBlur={(e) => form.setValue('gstin', e.target.value.toUpperCase())}
              />
            </Field>
            <Field
              label="Contact person"
              required
              error={form.formState.errors.contact?.message}
              hint="Who we call about bookings and paperwork."
            >
              <input {...form.register('contact')} />
            </Field>
            <Field label="Phone" required error={form.formState.errors.phone?.message}>
              <input {...form.register('phone')} />
            </Field>
            <Field label="Email" required error={form.formState.errors.email?.message}>
              <input {...form.register('email')} />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Agreement and pricing">
          <FormGrid>
            <Field
              label="Pricing basis"
              required
              hint="Contract = agreed lane prices under a signed agreement. Spot = priced load by load, with the client's written approval each time."
            >
              <select {...form.register('engagement')}>
                <option value="CONTRACT">Contract</option>
                <option value="SPOT">Spot</option>
              </select>
            </Field>
            {engagement === 'CONTRACT' ? (
              <>
                <Field
                  label="Agreement number"
                  required
                  error={form.formState.errors.agreementNo?.message}
                  hint="The reference on the signed rate contract, e.g. BRG/RC/2026-27."
                >
                  <input {...form.register('agreementNo')} />
                </Field>
                <Field label="Agreement valid from">
                  <input type="date" {...form.register('validFrom')} />
                </Field>
                <Field label="Agreement valid to">
                  <input type="date" {...form.register('validTo')} />
                </Field>
              </>
            ) : (
              /* BR-26 — a spot indent cannot be raised without the client's
                 written price approval attached. Said in plain words here. */
              <div className="muted" style={{ fontSize: 12.5, alignSelf: 'center', lineHeight: 1.55 }}>
                Spot clients have no agreed price list. Each load is priced on the day, and the client’s
                written approval of that price must be attached to the indent — their request for a truck —
                before it can be raised.
              </div>
            )}
          </FormGrid>
        </Panel>

        <Panel title="Documents">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Upload the client’s papers here as you create them. Compliance checks each one before the client can be
            given loads. A paper that is not to hand yet can be left out and uploaded later from Client verification.
          </p>
          <div data-client-papers style={{ display: 'grid', gap: 10 }}>
            {papers.map((p) => {
              const file = files[p.kind];
              return (
                <div
                  key={p.kind}
                  data-paper={p.kind}
                  className="surface"
                  style={{ padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.label}</div>
                    <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                      {file ? `📎 ${file.name}` : p.hint}
                    </div>
                  </div>
                  <label className={file ? 'btn btn-secondary btn-sm' : 'btn btn-sm'} style={{ cursor: 'pointer' }}>
                    {file ? 'Change file' : 'Upload file'}
                    <input
                      type="file"
                      name={`paper-${p.kind}`}
                      aria-label={`${p.label} file`}
                      accept="image/*,application/pdf"
                      hidden
                      onChange={(e) => {
                        const picked = e.target.files?.[0];
                        // Cleared so picking the same file again still fires.
                        e.target.value = '';
                        if (picked) chooseFile(p.kind, picked);
                      }}
                    />
                  </label>
                  {file && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Remove ${p.label} file`}
                      onClick={() => chooseFile(p.kind, undefined)}
                      style={{ background: 'transparent', color: 'var(--red)', borderColor: 'var(--red)' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            A scan or a photo — PDF, JPG or PNG, up to 10 MB each.
          </p>
        </Panel>

        <Panel title="Credit terms and service promise">
          <FormGrid>
            <Field
              label="Credit days"
              required
              hint="How many days after the invoice date this client has to pay. 0 means they pay before dispatch."
            >
              <input type="number" {...form.register('creditDays', { valueAsNumber: true })} />
            </Field>
            <Field
              label="Service promise"
              required
              error={form.formState.errors.serviceLevel?.message}
              hint="What we commit to, e.g. ‘Next day placement’ or ‘Scheduled’."
            >
              <input {...form.register('serviceLevel')} />
            </Field>
          </FormGrid>
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={submit} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating…' : 'Create client'}
            </button>
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { errorMessage } from '@/apis';
import { capitalizeWords } from '@/lib/format';
import { checkGstin } from '@/lib/gstin';
import { CityField, Field, FormGrid, ModuleGuard, PageHeader, Panel, Stack, useLevel, useToast } from '@/lib/ui';
import { createClient } from '../apis';

const schema = z
  .object({
    name: z.string().min(2, 'Required'),
    billingCity: z.string().min(2, 'Required').transform((v) => capitalizeWords(v)),
    // Advisory only (checked against GSTN, never blocking) — normalized to
    // uppercase but not format-gated, so a malformed value still saves.
    gstin: z
      .string()
      .transform((v) => v.toUpperCase())
      .optional(),
    contact: z.string().min(2, 'Required'),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Ten digits'),
    email: z.string().email('Not an email'),
    engagement: z.enum(['SPOT', 'CONTRACT']),
    agreementNo: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    creditDays: z.number().min(0).max(180),
    serviceLevel: z.string().min(2, 'Required'),
  })
  .refine((v) => v.engagement !== 'CONTRACT' || !!v.agreementNo, {
    message: 'A contract client needs an agreement number',
    path: ['agreementNo'],
  });

type Form = z.infer<typeof schema>;

/** Client wizard — company → billing → agreement → credit and service. */
export default function NewClientPage() {
  const router = useRouter();
  const toast = useToast();
  const level = useLevel('clients');
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { engagement: 'CONTRACT', creditDays: 45, serviceLevel: 'Next day placement' },
  });

  const engagement = form.watch('engagement');
  const gstinValue = form.watch('gstin');

  const submit = form.handleSubmit(async (values) => {
    try {
      const client = await createClient(values);
      toast(`${client.code} created`);
      router.push(`/clients/${client.id}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  });

  if (level !== 'EDIT') {
    return (
      <ModuleGuard module="clients">
        <PageHeader path="/clients/new" title="New client" module="clients" />
        <Panel>Creating a client is a finance action.</Panel>
      </ModuleGuard>
    );
  }

  return (
    <ModuleGuard module="clients">
      <PageHeader path="/clients/new" title="New client" sub="Company · billing · agreement · credit" module="clients" />
      <Stack>
        <Panel title="Company and billing">
          <FormGrid>
            <Field label="Name" required error={form.formState.errors.name?.message}>
              <input {...form.register('name')} />
            </Field>
            <Field label="Billing city" required error={form.formState.errors.billingCity?.message}>
              <CityField
                listId="cities-billing-city"
                {...form.register('billingCity')}
                onBlur={(e) => form.setValue('billingCity', capitalizeWords(e.target.value))}
              />
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
                {...form.register('gstin')}
                onBlur={(e) => form.setValue('gstin', e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Contact" required error={form.formState.errors.contact?.message}>
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

        <Panel title="Agreement">
          <FormGrid>
            <Field label="Engagement" required>
              <select {...form.register('engagement')}>
                <option value="CONTRACT">Contract</option>
                <option value="SPOT">Spot</option>
              </select>
            </Field>
            {engagement === 'CONTRACT' ? (
              <>
                <Field label="Agreement number" required error={form.formState.errors.agreementNo?.message}>
                  <input {...form.register('agreementNo')} />
                </Field>
                <Field label="Valid from">
                  <input type="date" {...form.register('validFrom')} />
                </Field>
                <Field label="Valid to">
                  <input type="date" {...form.register('validTo')} />
                </Field>
              </>
            ) : (
              <div className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>
                Rates are set per indent with the client’s written approval — a spot indent cannot be raised
                without that attachment (BR-26).
              </div>
            )}
          </FormGrid>
        </Panel>

        <Panel title="Credit and service">
          <FormGrid>
            <Field label="Credit days" required>
              <input type="number" {...form.register('creditDays', { valueAsNumber: true })} />
            </Field>
            <Field label="Service level" required error={form.formState.errors.serviceLevel?.message}>
              <input {...form.register('serviceLevel')} />
            </Field>
          </FormGrid>
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={submit} disabled={form.formState.isSubmitting}>
              Create client
            </button>
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

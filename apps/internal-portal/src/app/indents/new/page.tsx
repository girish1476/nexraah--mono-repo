'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { errorMessage, request } from '@/apis';
import { getRateCard, listClients } from '@/app/clients/apis';
import { Client, RateCardLane } from '@/app/clients/types';
import { inr, pct } from '@/lib/format';
import {
  Banner,
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
import { createIndent } from '../apis';

/**
 * Raise an indent — `/indents/new` · `indent.create` (part 04 §2).
 *
 * Two pricing paths. Contract fills the freight from the won RFQ lane; spot
 * needs a sourcing rate, a freight above it (BR-38) and the client's written
 * rate approval (BR-26) — without the attachment the indent cannot be raised,
 * and the database says so as well as this form.
 */

const schema = z
  .object({
    clientId: z.string().min(1, 'Required'),
    branchId: z.string().min(1, 'Required'),
    fromCity: z.string().min(2, 'Required'),
    toCity: z.string().min(2, 'Required'),
    material: z.string().min(2, 'Required'),
    weightTn: z.number().min(0.5, 'Required'),
    truckType: z.string().min(2, 'Required'),
    pickupDate: z.string().min(4, 'Required'),
    transitDays: z.number().min(0),
    reportingRule: z.enum(['SAME_DAY', 'NEXT_DAY', 'SCHEDULED']),
    remarks: z.string().optional(),
    rateSource: z.enum(['CONTRACT', 'SPOT']),
    sellRupees: z.number().min(1, 'Required'),
    sourcingRupees: z.number().optional(),
    bidMinRupees: z.number().min(0),
    bidMaxRupees: z.number().min(0),
    advancePct: z.number().min(0).max(100),
  })
  .refine((v) => v.bidMaxRupees >= v.bidMinRupees, {
    message: 'Bid max cannot be below bid min',
    path: ['bidMaxRupees'],
  })
  .refine((v) => v.rateSource !== 'SPOT' || (v.sourcingRupees ?? 0) > 0, {
    message: 'A spot indent needs a sourcing rate',
    path: ['sourcingRupees'],
  })
  .refine((v) => v.rateSource !== 'SPOT' || v.sellRupees > (v.sourcingRupees ?? 0), {
    message: 'A spot load is never quoted at a loss — the freight must exceed the sourcing rate (BR-38)',
    path: ['sellRupees'],
  });

type Form = z.infer<typeof schema>;

const BRANCHES = [
  { id: 'br-nsk', name: 'Nashik' },
  { id: 'br-pun', name: 'Pune' },
  { id: 'br-vja', name: 'Vijayawada' },
  { id: 'br-gdm', name: 'Gandhidham' },
  { id: 'br-hsr', name: 'Hosur' },
];

export default function NewIndentPage() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();

  const [clients, setClients] = useState<Client[]>([]);
  const [lanes, setLanes] = useState<RateCardLane[]>([]);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      branchId: 'br-nsk',
      reportingRule: 'SAME_DAY',
      rateSource: 'CONTRACT',
      transitDays: 2,
      advancePct: 40,
      bidMinRupees: 0,
      bidMaxRupees: 0,
    },
  });

  const clientId = form.watch('clientId');
  const rateSource = form.watch('rateSource');
  const sell = form.watch('sellRupees') ?? 0;
  const sourcing = form.watch('sourcingRupees') ?? 0;

  useEffect(() => {
    listClients().then(setClients).catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (!clientId) return;
    getRateCard(clientId).then(setLanes).catch(() => setLanes([]));
  }, [clientId]);

  const applyLane = (lane: RateCardLane) => {
    form.setValue('fromCity', lane.origin);
    form.setValue('toCity', lane.destination);
    form.setValue('truckType', lane.truckType);
    form.setValue('transitDays', lane.transitDays);
    form.setValue('reportingRule', lane.reportingRule);
    form.setValue('sellRupees', lane.ratePaise / 100);
    form.setValue('rateSource', 'CONTRACT');
    toast(`Freight filled from the won RFQ lane · ${inr(lane.ratePaise)}`);
  };

  const attachConfirmation = async () => {
    const { id } = await request<{ id: string }>({ url: '/attachments', method: 'POST', data: { kind: 'SPOT_CONFIRMATION' } });
    setConfirmationId(id);
    toast('Client rate approval attached');
  };

  const submit = form.handleSubmit(async (v) => {
    try {
      const indent = await createIndent({
        clientId: v.clientId,
        branchId: v.branchId,
        fromCity: v.fromCity,
        toCity: v.toCity,
        material: v.material,
        weightTn: v.weightTn,
        truckType: v.truckType,
        pickupDate: v.pickupDate,
        transitDays: v.transitDays,
        reportingRule: v.reportingRule,
        remarks: v.remarks,
        rateSource: v.rateSource,
        sellRatePaise: Math.round(v.sellRupees * 100),
        sourcingRatePaise: v.sourcingRupees ? Math.round(v.sourcingRupees * 100) : undefined,
        spotConfirmationAttachmentId: confirmationId ?? undefined,
        bidMinPaise: Math.round(v.bidMinRupees * 100),
        bidMaxPaise: Math.round(v.bidMaxRupees * 100),
        advancePct: v.advancePct,
      });
      toast(`${indent.code} raised · band is now locked (BR-39)`);
      router.push(`/indents/${indent.id}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  });

  if (!can('indent.create')) {
    return (
      <ModuleGuard module="indents">
        <PageHeader path="/indents/new" title="Raise an indent" module="indents" />
        <Panel>`indent.create` is not held by your role. It is grantable to any internal role (BR-41).</Panel>
      </ModuleGuard>
    );
  }

  const margin = sell - (rateSource === 'SPOT' ? sourcing : 0);

  return (
    <ModuleGuard module="indents">
      <PageHeader
        path="/indents/new"
        title="Raise an indent"
        sub="Branch is derived from the pickup city and carried unchanged to the trip and the LR (BR-20)."
        module="indents"
      />

      <Stack>
        <Panel title="Requirement">
          <FormGrid>
            <Field label="Client" required error={form.formState.errors.clientId?.message}>
              <select {...form.register('clientId')}>
                <option value="">Select</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.engagement}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Branch" required hint="Derived from the pickup city; carried unchanged (BR-20).">
              <select {...form.register('branchId')}>
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pickup city" required error={form.formState.errors.fromCity?.message}>
              <input {...form.register('fromCity')} />
            </Field>
            <Field label="Delivery city" required error={form.formState.errors.toCity?.message}>
              <input {...form.register('toCity')} />
            </Field>
            <Field label="Material" required error={form.formState.errors.material?.message}>
              <input {...form.register('material')} />
            </Field>
            <Field label="Weight (MT)" required error={form.formState.errors.weightTn?.message}>
              <input type="number" step="0.5" {...form.register('weightTn', { valueAsNumber: true })} />
            </Field>
            <Field label="Truck type" required error={form.formState.errors.truckType?.message}>
              <input {...form.register('truckType')} />
            </Field>
            <Field label="Pickup date" required error={form.formState.errors.pickupDate?.message}>
              <input type="date" {...form.register('pickupDate')} />
            </Field>
            <Field label="Transit days" hint="Actual delivery is measured against this (BR-27).">
              <input type="number" {...form.register('transitDays', { valueAsNumber: true })} />
            </Field>
            <Field label="Reporting rule" hint="Late reporting is a transit delay in its own right (BR-42).">
              <select {...form.register('reportingRule')}>
                <option value="SAME_DAY">Same day</option>
                <option value="NEXT_DAY">Next day</option>
                <option value="SCHEDULED">Scheduled</option>
              </select>
            </Field>
            <Field label="Remarks" hint="Carried to the trip and the lorry receipt (BR-28).">
              <input {...form.register('remarks')} />
            </Field>
          </FormGrid>
        </Panel>

        {lanes.length > 0 && (
          <Panel title="Rate card lanes for this client">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {lanes.map((lane) => (
                <button key={lane.id} className="btn btn-secondary btn-sm" onClick={() => applyLane(lane)}>
                  {lane.origin} → {lane.destination} · {inr(lane.ratePaise)}
                </button>
              ))}
            </div>
          </Panel>
        )}

        <Panel title="Pricing">
          <FormGrid>
            <Field label="Rate source" required>
              <select {...form.register('rateSource')}>
                <option value="CONTRACT">Contract — from the won RFQ lane</option>
                <option value="SPOT">Spot</option>
              </select>
            </Field>
            {rateSource === 'SPOT' && (
              <Field label="Sourcing rate (₹)" required error={form.formState.errors.sourcingRupees?.message}>
                <input type="number" {...form.register('sourcingRupees', { valueAsNumber: true })} />
              </Field>
            )}
            <Field label="Freight to client (₹)" required error={form.formState.errors.sellRupees?.message}>
              <input type="number" {...form.register('sellRupees', { valueAsNumber: true })} />
            </Field>
          </FormGrid>

          {rateSource === 'SPOT' && (
            <div style={{ marginTop: 12 }}>
              <Banner
                tone={margin > 0 ? 'mint' : 'red'}
                title={margin > 0 ? `Margin ${inr(margin * 100)}` : 'A spot load is never quoted at a loss'}
                right={
                  confirmationId ? (
                    <Tag tone="mint">Rate approval attached</Tag>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={attachConfirmation}>
                      Attach client rate approval
                    </button>
                  )
                }
              >
                {margin > 0 && sourcing > 0
                  ? `${pct((margin / sell) * 100)} over the sourcing rate. The client’s written rate approval is mandatory (BR-26).`
                  : 'The freight must exceed the sourcing rate — the database refuses the row otherwise (BR-38).'}
              </Banner>
            </div>
          )}
        </Panel>

        <Panel title="Placement terms">
          <FormGrid>
            <Field label="Bid minimum (₹)" hint="Below this a quote is refused at entry and never persisted.">
              <input type="number" {...form.register('bidMinRupees', { valueAsNumber: true })} />
            </Field>
            <Field
              label="Bid maximum (₹)"
              hint="Above this a quote is kept and flagged; awarding it needs leadership (D-39)."
              error={form.formState.errors.bidMaxRupees?.message}
            >
              <input type="number" {...form.register('bidMaxRupees', { valueAsNumber: true })} />
            </Field>
            <Field label="Advance %" hint="Defaults from the awarded vendor's standing policy (BR-30).">
              <input type="number" {...form.register('advancePct', { valueAsNumber: true })} />
            </Field>
          </FormGrid>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            The band becomes read-only the moment this indent is published, before the first quote and after
            (BR-39). A lane that draws no in-band quote is a market gap, and the fix is recruitment.
          </p>
          <div style={{ marginTop: 16 }}>
            <button
              className="btn"
              onClick={submit}
              disabled={form.formState.isSubmitting || (rateSource === 'SPOT' && !confirmationId)}
            >
              Raise indent
            </button>
            {rateSource === 'SPOT' && !confirmationId && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
                Attach the client’s written rate approval first.
              </span>
            )}
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

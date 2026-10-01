'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FieldErrors, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { errorMessage, request } from '@/apis';
import { getRateCard, listClients } from '@/app/clients/apis';
import { liveLanes } from '@/app/clients/lanes';
import { Client, RateCardLane, laneFreightPaise, rateWithBasis } from '@/app/clients/types';
import { capitalizeWords, fmtDate, inr, pct } from '@/lib/format';
import {
  Banner,
  CityField,
  Field,
  FormGrid,
  ModuleGuard,
  PageHeader,
  PageIntro,
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
 * The client decides how the load is priced, so the form follows the client:
 *
 * - **Contract client** — pick one of their agreed rate card lanes from a
 *   dropdown and everything the lane knows is filled in and locked: route,
 *   truck type, transit days, reporting rule and the freight. The lane's id
 *   goes with the indent, so the server cross-checks the rate and charges the
 *   lane's late-delivery penalty. A route their rate card does not cover can
 *   still be booked as spot.
 * - **Spot client** (or a contract client off their rate card) — the details
 *   are entered by hand, with a sourcing rate, a freight above it (BR-38), and
 *   the client's confirmation screenshot attached (BR-26). Without the
 *   screenshot the indent cannot be raised, and the database says so as well
 *   as this form.
 */

const schema = z
  .object({
    clientId: z.string().min(1, 'Required'),
    fromCity: z.string().min(2, 'Required').transform((v) => capitalizeWords(v)),
    toCity: z.string().min(2, 'Required').transform((v) => capitalizeWords(v)),
    material: z.string().min(2, 'Required'),
    weightTn: z.number({ error: 'Required' }).min(0.5, 'Required'),
    truckType: z.string().min(2, 'Required'),
    pickupDate: z.string().min(4, 'Required'),
    transitDays: z.number({ error: 'Enter the transit days' }).int('Whole days only').min(0),
    reportingRule: z.enum(['SAME_DAY', 'NEXT_DAY', 'SCHEDULED']),
    remarks: z.string().optional(),
    pickupAddress: z.string().max(300, 'Keep it under 300 characters').optional(),
    dropAddress: z.string().max(300, 'Keep it under 300 characters').optional(),
    rateSource: z.enum(['CONTRACT', 'SPOT']),
    rateCardLaneId: z.string().optional(),
    sellRupees: z.number({ error: 'Required' }).min(1, 'Required'),
    sourcingRupees: z.number().optional(),
    // Optional on purpose: left blank, the awarded transporter's standing
    // advance policy applies. Filled in, it is this order's own figure.
    advancePct: z
      .number({ error: 'Enter a number from 0 to 100, or leave it blank' })
      .min(0, 'Enter a number from 0 to 100')
      .max(100, 'Enter a number from 0 to 100')
      .optional(),
  })
  .refine((v) => v.rateSource !== 'CONTRACT' || !!v.rateCardLaneId, {
    message: 'Choose the agreed lane — or book it as spot if their rate card does not cover this route',
    path: ['rateCardLaneId'],
  })
  .refine((v) => v.rateSource !== 'SPOT' || (v.sourcingRupees ?? 0) > 0, {
    message: 'A spot load needs a sourcing rate',
    path: ['sourcingRupees'],
  })
  .refine((v) => v.rateSource !== 'SPOT' || v.sellRupees > (v.sourcingRupees ?? 0), {
    message: 'A spot load is never quoted at a loss — the freight must exceed the sourcing rate',
    path: ['sellRupees'],
  });

type Form = z.infer<typeof schema>;

/** Blank or non-numeric input becomes `undefined`, never `NaN` — zod rejects NaN even on an optional number. */
const optionalNumber = (v: unknown) =>
  v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v);

const REPORTING_LABEL: Record<RateCardLane['reportingRule'], string> = {
  SAME_DAY: 'Same day',
  NEXT_DAY: 'Next day',
  SCHEDULED: 'Scheduled',
};

export default function NewIndentPage() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();

  const [clients, setClients] = useState<Client[]>([]);
  const [lanes, setLanes] = useState<RateCardLane[] | null>(null);
  const [offRateCard, setOffRateCard] = useState(false);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [confirmationFile, setConfirmationFile] = useState<File | null>(null);
  const [confirmationPreview, setConfirmationPreview] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      reportingRule: 'SAME_DAY',
      rateSource: 'CONTRACT',
      transitDays: 2,
    },
  });
  const errors = form.formState.errors;

  const clientId = form.watch('clientId');
  const rateSource = form.watch('rateSource');
  const laneId = form.watch('rateCardLaneId');
  const sell = form.watch('sellRupees') ?? 0;
  const sourcing = form.watch('sourcingRupees') ?? 0;
  const weightTn = form.watch('weightTn');

  const client = clients.find((c) => c.id === clientId);
  const isContractClient = client?.engagement === 'CONTRACT';
  const live = useMemo(() => (lanes ? liveLanes(lanes).map((l) => l.lane) : []), [lanes]);
  const lane = live.find((l) => l.id === laneId) ?? null;
  // Every detail a chosen lane carries is locked to it.
  const locked = rateSource === 'CONTRACT' && !!lane;
  const perTonne = locked && lane?.rateBasis === 'PMT';

  // A per-tonne lane bills rate × weight, so the freight follows the weight.
  useEffect(() => {
    if (!locked || !lane) return;
    const w = Number(weightTn);
    const paise = laneFreightPaise(lane, Number.isFinite(w) ? w : 0);
    form.setValue('sellRupees', paise / 100, { shouldValidate: lane.rateBasis !== 'PMT' || w > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, lane?.id, lane?.rateBasis, weightTn]);

  useEffect(() => {
    // Only clients Compliance has cleared can be booked against, so the others
    // are not offered — they used to be, and the refusal came only after the whole
    // form had been filled in.
    listClients()
      .then((all) => setClients(all.filter((c) => c.status === 'ACTIVE')))
      .catch(() => setClients([]));
  }, []);

  // A new client starts the pricing over: contract clients are priced from
  // their rate card, spot clients by hand.
  useEffect(() => {
    setLanes(null);
    setOffRateCard(false);
    form.setValue('rateCardLaneId', undefined);
    if (!clientId) return;
    const c = clients.find((x) => x.id === clientId);
    form.setValue('rateSource', c?.engagement === 'SPOT' ? 'SPOT' : 'CONTRACT');
    if (c?.engagement === 'CONTRACT') getRateCard(clientId).then(setLanes).catch(() => setLanes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clients]);

  useEffect(() => {
    if (!confirmationFile || !confirmationFile.type.startsWith('image/')) {
      setConfirmationPreview(null);
      return;
    }
    const url = URL.createObjectURL(confirmationFile);
    setConfirmationPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [confirmationFile]);

  const chooseLane = (id: string) => {
    const l = live.find((x) => x.id === id);
    form.setValue('rateCardLaneId', id || undefined, { shouldValidate: true });
    if (!l) return;
    form.setValue('fromCity', l.origin, { shouldValidate: true });
    form.setValue('toCity', l.destination, { shouldValidate: true });
    form.setValue('truckType', l.truckType, { shouldValidate: true });
    form.setValue('transitDays', l.transitDays, { shouldValidate: true });
    // A lane added directly (not won at RFQ) carries no reporting rule — keep
    // whatever the form has, and leave the choice open, rather than blanking it.
    if (l.reportingRule) form.setValue('reportingRule', l.reportingRule);
    const w = Number(form.getValues('weightTn'));
    form.setValue('sellRupees', laneFreightPaise(l, Number.isFinite(w) ? w : 0) / 100, { shouldValidate: true });
  };

  const bookAsSpot = (spot: boolean) => {
    setOffRateCard(spot);
    form.setValue('rateSource', spot ? 'SPOT' : 'CONTRACT');
    form.setValue('rateCardLaneId', undefined);
  };

  /**
   * `POST /attachments` is `multipart/form-data` with field `file` — axios
   * sets the boundary itself once it sees a FormData body, so the request
   * must not force a JSON Content-Type (see vendors/new/page.tsx's `attach`).
   */
  const attachConfirmation = async () => {
    if (!confirmationFile) return;
    setAttaching(true);
    try {
      const formData = new FormData();
      formData.append('file', confirmationFile);
      formData.append('kind', 'SPOT_CONFIRMATION');
      const { id } = await request<{ id: string }>({ url: '/attachments', method: 'POST', data: formData });
      setConfirmationId(id);
      toast('Client confirmation attached');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setAttaching(false);
    }
  };

  const onInvalid = (errs: FieldErrors<Form>) => {
    // The lane rule is a refinement, which only runs once every plain field is
    // valid — so on a half-filled contract form it never said the lane was
    // missing. Say it here, first, because choosing the lane fills most of the rest.
    if (rateSource === 'CONTRACT' && isContractClient && !laneId) {
      const message = 'Choose the agreed lane — or book it as spot if their rate card does not cover this route';
      form.setError('rateCardLaneId', { message });
      toast(message);
      return;
    }
    // Never fail silently: a hidden field (the sourcing rate after switching
    // back to Contract) or one without an inline error made the button look dead.
    const [field, error] = Object.entries(errs)[0] ?? [];
    toast(field ? `Check ${field}: ${error?.message ?? 'invalid value'}` : 'Please check the form');
  };

  const submit = form.handleSubmit(async (v) => {
    try {
      const indent = await createIndent({
        clientId: v.clientId,
        fromCity: v.fromCity,
        toCity: v.toCity,
        material: v.material,
        weightTn: v.weightTn,
        truckType: v.truckType,
        pickupDate: v.pickupDate,
        transitDays: v.transitDays,
        reportingRule: v.reportingRule,
        remarks: v.remarks,
        pickupAddress: v.pickupAddress?.trim() || undefined,
        dropAddress: v.dropAddress?.trim() || undefined,
        rateSource: v.rateSource,
        rateCardLaneId: v.rateSource === 'CONTRACT' ? v.rateCardLaneId : undefined,
        sellRatePaise: Math.round(v.sellRupees * 100),
        sourcingRatePaise: v.rateSource === 'SPOT' && v.sourcingRupees ? Math.round(v.sourcingRupees * 100) : undefined,
        spotConfirmationAttachmentId: v.rateSource === 'SPOT' ? (confirmationId ?? undefined) : undefined,
        advancePct: v.advancePct,
      });
      toast(`${indent.code} raised`);
      router.push(`/indents/${indent.id}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  }, onInvalid);

  if (!can('indent.create')) {
    return (
      <ModuleGuard module="indents">
        <PageHeader path="/indents/new" title="New load request" module="indents" />
        <PageIntro
          what="Raise an indent — turn a client's shipment need into a priced request for a truck, ready to place with a transporter once it's published."
          who="Whoever holds indent creation access — usually operations or compliance staff."
        />
        <Panel>
          You don’t have permission to raise indents. Ask an admin to grant you indent creation access, or have
          Operations raise this one for you.
        </Panel>
      </ModuleGuard>
    );
  }

  const margin = sell - (rateSource === 'SPOT' ? sourcing : 0);
  const lockedStyle = locked ? { background: 'var(--color-surface-sunken)' } : undefined;

  return (
    <ModuleGuard module="indents">
      <PageHeader
        path="/indents/new"
        title="New load request"
        sub="Branch is derived from the pickup city and carried unchanged to the trip and the LR."
        module="indents"
      />
      <PageIntro
        what="Raise an indent — turn a client's shipment need into a priced request for a truck, ready to place with a transporter once it's published."
        who="Whoever holds indent creation access — usually operations or compliance staff."
      >
        Pick the client first. A contract client’s load is filled in from the agreed lane you choose; a spot load is
        entered by hand with the client’s confirmation screenshot attached.
      </PageIntro>

      <Stack>
        <Panel title="1 · Client">
          <FormGrid>
            <Field label="Client" required error={errors.clientId?.message}>
              <select {...form.register('clientId')}>
                <option value="">Select</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.engagement}
                  </option>
                ))}
              </select>
            </Field>
            {client && (
              <Field label="Priced as">
                <div style={{ paddingTop: 6 }}>
                  <Tag tone={rateSource === 'CONTRACT' ? 'mint' : 'blue'}>
                    {rateSource === 'CONTRACT' ? 'Contract — from the agreed rate card' : 'Spot — entered for this load'}
                  </Tag>
                </div>
              </Field>
            )}
          </FormGrid>

          {isContractClient && (
            <div style={{ marginTop: 12 }}>
              {lanes === null ? (
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                  Loading the client’s rate card…
                </p>
              ) : offRateCard ? (
                <Banner
                  tone="blue"
                  title="Booked as spot — off the rate card"
                  right={
                    live.length > 0 ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => bookAsSpot(false)}>
                        Use the rate card instead
                      </button>
                    ) : undefined
                  }
                >
                  Enter the load by hand and attach the client’s confirmation of this price.
                </Banner>
              ) : live.length === 0 ? (
                <Banner
                  tone="flag"
                  title="This contract client has no agreed lane in force"
                  right={
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => bookAsSpot(true)}>
                      Book it as spot
                    </button>
                  }
                >
                  Add the lane to their rate card (Clients → Rate revision), or book this one load as spot with the
                  client’s written confirmation.
                </Banner>
              ) : (
                <FormGrid>
                  <Field
                    label="Agreed lane"
                    required
                    error={errors.rateCardLaneId?.message}
                    hint="Route, truck type, transit days, reporting and the freight are filled in from the lane."
                  >
                    <select value={laneId ?? ''} onChange={(e) => chooseLane(e.target.value)}>
                      <option value="">Choose a lane…</option>
                      {live.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.origin} → {l.destination} · {l.truckType} · {rateWithBasis(inr(l.ratePaise), l.rateBasis)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Route not on the rate card?">
                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={() => bookAsSpot(true)}>
                      Book it as spot
                    </button>
                  </Field>
                </FormGrid>
              )}
              {lane && (
                <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
                  Agreed {rateWithBasis(inr(lane.ratePaise), lane.rateBasis)}
                  {lane.rateBasis === 'PMT' ? ' — the freight is this × the weight' : ''} · valid {fmtDate(lane.validFrom)} → {lane.validTo ? fmtDate(lane.validTo) : 'open'}
                  {lane.bidMinPaise !== null && lane.bidMaxPaise !== null
                    ? ` · transporter bids ${inr(lane.bidMinPaise)}–${inr(lane.bidMaxPaise)}`
                    : ''}
                  {lane.transitPenaltyApplies ? ` · late delivery ${inr(lane.transitPenaltyPerDayPaise)}/day` : ''}
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="2 · The load">
          <FormGrid>
            <Field
              label="Pickup city"
              required
              hint={locked ? 'From the agreed lane' : 'The branch that runs this load is worked out from the pickup city.'}
              error={errors.fromCity?.message}
            >
              <CityField
                listId="cities-from-city"
                readOnly={locked}
                style={lockedStyle}
                {...form.register('fromCity')}
                onBlur={(e) => form.setValue('fromCity', capitalizeWords(e.target.value))}
              />
            </Field>
            <Field label="Delivery city" required hint={locked ? 'From the agreed lane' : undefined} error={errors.toCity?.message}>
              <CityField
                listId="cities-to-city"
                readOnly={locked}
                style={lockedStyle}
                {...form.register('toCity')}
                onBlur={(e) => form.setValue('toCity', capitalizeWords(e.target.value))}
              />
            </Field>
            <Field label="Truck type" required hint={locked ? 'From the agreed lane' : undefined} error={errors.truckType?.message}>
              <input readOnly={locked} style={lockedStyle} {...form.register('truckType')} />
            </Field>
            <Field label="Material" required error={errors.material?.message}>
              <input {...form.register('material')} />
            </Field>
            <Field label="Weight (MT)" required error={errors.weightTn?.message}>
              <input type="number" step="0.5" {...form.register('weightTn', { valueAsNumber: true })} />
            </Field>
            <Field label="Pickup date" required error={errors.pickupDate?.message}>
              <input type="date" {...form.register('pickupDate')} />
            </Field>
            <Field
              label="Transit days"
              hint={locked ? 'From the agreed lane' : 'Actual delivery is measured against this.'}
              error={errors.transitDays?.message}
            >
              <input
                type="number"
                min={0}
                step={1}
                readOnly={locked}
                style={lockedStyle}
                {...form.register('transitDays', { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Reporting rule"
              hint={locked && lane?.reportingRule ? 'From the agreed lane' : 'Late reporting is a transit delay in its own right.'}
            >
              {/* A disabled field is dropped from the submitted values, so a
                  locked rule is shown as text; the form keeps the lane's value. */}
              {lane && locked && lane.reportingRule ? (
                <input readOnly style={lockedStyle} value={REPORTING_LABEL[lane.reportingRule]} />
              ) : (
                <select {...form.register('reportingRule')}>
                  <option value="SAME_DAY">Same day</option>
                  <option value="NEXT_DAY">Next day</option>
                  <option value="SCHEDULED">Scheduled</option>
                </select>
              )}
            </Field>
            <Field label="Remarks" hint="Carried to the trip and the lorry receipt.">
              <input {...form.register('remarks')} />
            </Field>
            <Field label="Loading address" hint="Where the truck reports to load. Shown on the order." error={errors.pickupAddress?.message}>
              <textarea rows={2} {...form.register('pickupAddress')} placeholder="e.g. Gate 3, MIDC Ambad, Nashik 422010" />
            </Field>
            <Field label="Unloading address" hint="Where the goods are delivered. Shown on the order." error={errors.dropAddress?.message}>
              <textarea rows={2} {...form.register('dropAddress')} placeholder="e.g. Consignee warehouse, Dankuni, Kolkata 712311" />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="3 · Pricing">
          <FormGrid>
            {rateSource === 'SPOT' && (
              <Field label="Sourcing rate (₹)" required error={errors.sourcingRupees?.message}>
                <input type="number" {...form.register('sourcingRupees', { setValueAs: optionalNumber })} />
              </Field>
            )}
            <Field
              label="Freight to client (₹)"
              required
              hint={
                perTonne && lane
                  ? `${inr(lane.ratePaise)} per tonne × ${Number(weightTn) > 0 ? `${weightTn} MT` : 'the weight (enter it above)'}`
                  : locked
                    ? 'The agreed lane rate'
                    : undefined
              }
              error={errors.sellRupees?.message}
            >
              <input type="number" readOnly={locked} style={lockedStyle} {...form.register('sellRupees', { valueAsNumber: true })} />
            </Field>
          </FormGrid>

          {rateSource === 'SPOT' && (
            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              {sourcing > 0 && sell > 0 && (
                <Banner
                  tone={margin > 0 ? 'mint' : 'red'}
                  title={margin > 0 ? `Margin ${inr(margin * 100)}` : 'A spot load is never quoted at a loss'}
                >
                  {margin > 0
                    ? `${pct((margin / sell) * 100)} over the sourcing rate.`
                    : 'This load would be booked at a loss — raise the freight above the sourcing rate.'}
                </Banner>
              )}
              <div
                style={{
                  border: `1px dashed ${confirmationId ? 'var(--mint)' : 'var(--flag)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <strong style={{ flex: 1 }}>Client’s confirmation screenshot</strong>
                  {confirmationId ? <Tag tone="mint">Attached</Tag> : <Tag tone="flag">Required</Tag>}
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  The mail, WhatsApp message or letter where the client agreed this price. A spot load cannot be raised
                  without it.
                </p>
                {!confirmationId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setConfirmationFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={attachConfirmation}
                      disabled={!confirmationFile || attaching}
                    >
                      {attaching ? 'Attaching…' : 'Attach'}
                    </button>
                  </div>
                )}
                {confirmationPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={confirmationPreview}
                    alt="Client confirmation screenshot"
                    style={{
                      marginTop: 10,
                      maxWidth: '100%',
                      maxHeight: 260,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-divider)',
                    }}
                  />
                )}
                {confirmationFile && !confirmationPreview && (
                  <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
                    {confirmationFile.name}
                  </p>
                )}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="4 · Advance payment">
          <FormGrid>
            <Field
              label="Advance % for this order (optional)"
              hint="Leave blank to use the transporter's standing advance policy — that is what normally applies. Fill it in only if this one order needs a different advance."
              error={errors.advancePct?.message}
            >
              <input
                type="number"
                min={0}
                max={100}
                placeholder="Transporter's policy"
                {...form.register('advancePct', { setValueAs: optionalNumber })}
              />
            </Field>
          </FormGrid>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            The bid limits for transporter quotes are not set here. They come from this client’s rate card
            for the lane, and only Leadership can change them once set.
          </p>
          <div style={{ marginTop: 16 }}>
            <button
              className="btn"
              onClick={submit}
              disabled={form.formState.isSubmitting || (rateSource === 'SPOT' && !confirmationId)}
            >
              Raise indent
            </button>
            {rateSource === 'SPOT' && !confirmationId && clientId && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
                Attach the client’s confirmation screenshot first.
              </span>
            )}
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

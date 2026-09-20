'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { listClients } from '@/app/clients/apis';
import { Client } from '@/app/clients/types';
import { listTrips } from '@/app/trips/apis';
import { TripListRow } from '@/app/trips/types';
import { fmtDate, inr } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  useCan,
  useToast,
} from '@/lib/ui';
import { getInvoice, updateInvoice } from '../../apis';
import { InvoiceDetail } from '../../types';

/**
 * Edit an invoice — `/invoices/[id]/edit` · `invoice.create` (part 08,
 * added 2026-09-20).
 *
 * A draft is fully editable, the same shape as the create form. An issued
 * invoice with no receipt against it yet is editable too, but its
 * consignments are locked — `InvoicingService.update()` refuses a `tripIds`
 * change once `generate()` has already marked those trips `billed`, so this
 * screen doesn't offer the checkbox table for one; the client and trip list
 * both render read-only instead. Either way, the moment a receipt exists the
 * server refuses the whole edit — the block below renders before the form
 * for that case, same as it does for a cancelled invoice.
 */
export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const can = useCan();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [trips, setTrips] = useState<TripListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    invoiceDate: '',
    dueDate: '',
    loadingRupees: 0,
    unloadingRupees: 0,
    detentionRupees: 0,
    otherRupees: 0,
    discountRupees: 0,
    notes: '',
  });

  useEffect(() => {
    getInvoice(id)
      .then((inv) => {
        setInvoice(inv);
        setClientId(inv.clientId);
        setSelected(Object.fromEntries(inv.trips.map((t) => [t.id, true])));
        setForm({
          invoiceDate: inv.invoiceDate.slice(0, 10),
          dueDate: inv.dueDate.slice(0, 10),
          loadingRupees: inv.loadingPaise / 100,
          unloadingRupees: inv.unloadingPaise / 100,
          detentionRupees: inv.detentionPaise / 100,
          otherRupees: inv.otherPaise / 100,
          discountRupees: inv.discountPaise / 100,
          notes: inv.notes,
        });
      })
      .catch((e) => setError(errorMessage(e)));
    listClients().then(setClients).catch(() => setClients([]));
    listTrips({ stage: 'DELIVERED' })
      .then(setTrips)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  // Every hook has to run on every render regardless of loading/blocked
  // state below, so this sits ahead of all the early returns rather than
  // after them — computed with null-safe fallbacks since `invoice`/`trips`
  // aren't loaded yet on the first render.
  //
  // The trips a draft already carries are never marked `billed` (that only
  // happens at `generate()`), so they already appear in `trips` (delivered,
  // unbilled) — merged here only as a safety net against a race where a
  // fetch landed between the invoice load and the trip list load.
  const billablePool = useMemo(() => {
    const byId = new Map((trips ?? []).map((t) => [t.id, t]));
    for (const t of invoice?.trips ?? []) if (!byId.has(t.id)) byId.set(t.id, t);
    return [...byId.values()];
  }, [trips, invoice]);

  if (!can('invoice.create')) {
    return (
      <ModuleGuard module="invoices">
        <PageHeader path="/invoices/[id]/edit" title="Edit invoice" module="invoices" />
        <Panel>Invoicing is a finance action.</Panel>
      </ModuleGuard>
    );
  }

  if (error) return <ErrorState message={error} />;
  if (!invoice || !trips) return <Loading what="Loading the invoice" />;

  if (invoice.status === 'CANCELLED') {
    return (
      <ModuleGuard module="invoices">
        <PageHeader
          path={`/invoices/${invoice.code ?? 'draft'}/edit`}
          title="Edit invoice"
          module="invoices"
        />
        <Banner tone="red" title="This invoice is cancelled">
          A cancelled invoice can't be edited. Raise a new one if the shipment still needs to be billed.
        </Banner>
      </ModuleGuard>
    );
  }

  if (invoice.receivedPaise > 0) {
    return (
      <ModuleGuard module="invoices">
        <PageHeader
          path={`/invoices/${invoice.code ?? 'draft'}/edit`}
          title="Edit invoice"
          module="invoices"
        />
        <Banner tone="flag" title="A receipt is already recorded against this invoice">
          Once money has been collected against an invoice its figures are locked, so the receipt and the total
          never disagree. Cancel this invoice and raise a new one if it needs to change.
        </Banner>
      </ModuleGuard>
    );
  }

  const isDraft = invoice.status === 'DRAFT';
  const client = clients.find((c) => c.id === clientId);

  const billable = billablePool.filter((t) => !clientId || t.clientName === client?.name);
  const chosen = isDraft ? billable.filter((t) => selected[t.id]) : invoice.trips;
  const freightPaise = chosen.reduce((a, t) => a + t.sellRatePaise, 0);
  const extras =
    (form.loadingRupees + form.unloadingRupees + form.detentionRupees + form.otherRupees - form.discountRupees) * 100;
  const subtotal = freightPaise + extras;
  const roundOffPaise = Math.round(subtotal / 100) * 100 - subtotal;
  const totalPaise = subtotal + roundOffPaise;

  const tripIdsChanged =
    isDraft &&
    (chosen.length !== invoice.tripIds.length || chosen.some((t) => !invoice.tripIds.includes(t.id)));

  const submit = async () => {
    setBusy(true);
    try {
      await updateInvoice(id, {
        clientId: isDraft ? clientId : undefined,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate,
        ...(tripIdsChanged ? { tripIds: chosen.map((t) => t.id), freightPaise } : {}),
        loadingPaise: form.loadingRupees * 100,
        unloadingPaise: form.unloadingRupees * 100,
        detentionPaise: form.detentionRupees * 100,
        otherPaise: form.otherRupees * 100,
        discountPaise: form.discountRupees * 100,
        notes: form.notes,
      });
      toast('Invoice updated');
      router.push(`/invoices/${id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<TripListRow>[] = [
    ...(isDraft
      ? [
          {
            key: 'pick',
            label: '',
            render: (r: TripListRow) => (
              <input
                type="checkbox"
                checked={!!selected[r.id]}
                onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })}
              />
            ),
          } as Column<TripListRow>,
        ]
      : []),
    { key: 'trip', label: 'Trip', mono: true, render: (r) => r.code },
    { key: 'lr', label: 'LR', mono: true, render: (r) => r.lrCode ?? '—' },
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
    { key: 'freight', label: 'Freight', align: 'right', render: (r) => inr(r.sellRatePaise) },
  ];

  return (
    <ModuleGuard module="invoices">
      <PageHeader
        path={`/invoices/${invoice.code ?? 'draft'}/edit`}
        title={invoice.code ? `Edit ${invoice.code}` : 'Edit draft'}
        sub={isDraft ? 'Anything can change on a draft.' : 'Dates, charges and notes only — the consignments are locked once issued.'}
        module="invoices"
      />

      <PageIntro
        what="Change the dates, the charges or (on a draft only) the client and the consignments billed. The total recomputes the same way it did when this was first raised."
        who="Only finance can edit invoices."
      />

      <Stack>
        <Banner tone="blue" title="GST payable by recipient under reverse charge">
          Section 9(3), CGST Act 2017. No tax has been charged on this invoice — nothing here changes that.
        </Banner>

        <Panel title="Client and dates">
          <FormGrid>
            <Field label="Client" required>
              {isDraft ? (
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Select</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={invoice.clientName} disabled />
              )}
            </Field>
            <Field label="Invoice date" required>
              <input
                type="date"
                value={form.invoiceDate}
                onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
              />
            </Field>
            <Field label="Due date" hint={client ? `From ${client.creditDays} credit days` : undefined}>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Consignments" pad={false}>
          {!isDraft && (
            <p className="hint" style={{ margin: '10px 15px 0' }}>
              Locked — an issued invoice's consignments can't change. Cancel this invoice and raise a new one if
              they need to.
            </p>
          )}
          <DataTable
            columns={columns}
            rows={isDraft ? billable : invoice.trips}
            rowKey={(r) => r.id}
            empty="No delivered unbilled consignments for this client."
          />
        </Panel>

        <Panel title="Charges">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            These are the <strong>billed</strong> values from charge capture, not the cost paid to the
            transporter.
          </p>
          <FormGrid>
            {(
              [
                ['loadingRupees', 'Loading'],
                ['unloadingRupees', 'Unloading'],
                ['detentionRupees', 'Detention'],
                ['otherRupees', 'Other'],
                ['discountRupees', 'Discount'],
              ] as [keyof typeof form, string][]
            ).map(([key, label]) => (
              <Field key={key} label={`${label} (₹)`}>
                <input
                  type="number"
                  value={(form[key] as number) || ''}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                />
              </Field>
            ))}
            <Field label="Notes">
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Total">
          <div style={{ display: 'grid', gap: 4, maxWidth: 380 }}>
            <Row label="Freight" value={inr(freightPaise)} />
            <Row label="Charges and discount" value={inr(extras)} />
            <Row label="Round off" value={inr(roundOffPaise)} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--color-divider)',
                paddingTop: 6,
                fontWeight: 600,
              }}
            >
              <span>Total</span>
              <span className="mono" style={{ fontSize: 17 }}>
                {inr(totalPaise)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-secondary"
              onClick={() => router.push(`/invoices/${id}`)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn"
              onClick={submit}
              disabled={busy || !clientId || (isDraft && chosen.length === 0)}
            >
              Save changes
            </button>
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

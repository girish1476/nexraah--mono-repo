'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { createInvoice, generateInvoice } from '../apis';

/**
 * Raise an invoice — `/invoices/new` · `invoice.create` (part 08 §1).
 *
 * One invoice, many delivered unbilled trips. Loading, unloading, detention
 * and other appear only where that client's arrangement provides for them
 * (D-04), and the figures are the **billed** amounts from charge capture, not
 * the cost paid to the transporter (BR-45).
 */
export default function NewInvoicePage() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();

  const [clients, setClients] = useState<Client[]>([]);
  const [trips, setTrips] = useState<TripListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    loadingRupees: 0,
    unloadingRupees: 0,
    detentionRupees: 0,
    otherRupees: 0,
    discountRupees: 0,
    notes: '',
  });

  useEffect(() => {
    listClients().then(setClients).catch(() => setClients([]));
    listTrips({ stage: 'DELIVERED' })
      .then(setTrips)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const client = clients.find((c) => c.id === clientId);
  const billable = useMemo(
    () => (trips ?? []).filter((t) => !clientId || t.clientName === client?.name),
    [trips, clientId, client],
  );

  const chosen = billable.filter((t) => selected[t.id]);
  const freightPaise = chosen.reduce((a, t) => a + t.sellRatePaise, 0);
  const extras =
    (form.loadingRupees + form.unloadingRupees + form.detentionRupees + form.otherRupees - form.discountRupees) * 100;
  const subtotal = freightPaise + extras;
  const roundOffPaise = Math.round(subtotal / 100) * 100 - subtotal;
  const totalPaise = subtotal + roundOffPaise;

  const submit = async (issue: boolean) => {
    setBusy(true);
    try {
      // Rounding and the total stay on screen only — the server computes both
      // from the heads (NFR-09) and refuses a body that carries them. A blank
      // due date falls back to the client's credit terms, since the API
      // requires one and the field is not otherwise mandatory here.
      const dueDate =
        form.dueDate ||
        new Date(new Date(form.invoiceDate).getTime() + (client?.creditDays ?? 0) * 86_400_000)
          .toISOString()
          .slice(0, 10);
      const invoice = await createInvoice({
        clientId,
        invoiceDate: form.invoiceDate,
        dueDate,
        tripIds: chosen.map((t) => t.id),
        freightPaise,
        loadingPaise: form.loadingRupees * 100,
        unloadingPaise: form.unloadingRupees * 100,
        detentionPaise: form.detentionRupees * 100,
        otherPaise: form.otherRupees * 100,
        discountPaise: form.discountRupees * 100,
        notes: form.notes,
      });
      if (issue) {
        const issued = await generateInvoice(invoice.id);
        toast(`${issued.code} issued`);
      } else {
        toast('Draft saved');
      }
      router.push(`/invoices/${invoice.id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!can('invoice.create')) {
    return (
      <ModuleGuard module="invoices">
        <PageHeader path="/invoices/new" title="New client bill" module="invoices" />
        <PageIntro
          what="Build a new invoice by picking one or more delivered consignments for a client that haven't been billed yet, adding any extra charges, and saving it as a draft or generating the invoice number right away."
          who="Only finance can raise invoices."
        />
        <Panel>Invoicing is a finance action.</Panel>
      </ModuleGuard>
    );
  }

  if (error) return <ErrorState message={error} />;
  if (!trips) return <Loading what="Loading billable consignments" />;

  const columns: Column<TripListRow>[] = [
    {
      key: 'pick',
      label: '',
      render: (r) => (
        <input
          type="checkbox"
          checked={!!selected[r.id]}
          onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })}
        />
      ),
    },
    { key: 'trip', label: 'Trip', mono: true, render: (r) => r.code },
    { key: 'lr', label: 'LR', mono: true, render: (r) => r.lrCode ?? '—' },
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
    { key: 'freight', label: 'Freight', align: 'right', render: (r) => inr(r.sellRatePaise) },
  ];

  return (
    <ModuleGuard module="invoices">
      <PageHeader path="/invoices/new" title="New client bill" sub="One invoice, one or many delivered consignments" module="invoices" />

      <PageIntro
        what="Build a new invoice by picking one or more delivered consignments for a client that haven't been billed yet, adding any extra charges, and saving it as a draft or generating the invoice number right away."
        who="Only finance can raise invoices."
      />

      <Stack>
        <Banner tone="blue" title="GST payable by recipient under reverse charge">
          Section 9(3), CGST Act 2017. No tax has been charged on this invoice — there is no tax field on this
          screen, in the ledger, on the detail page or on any of the four printed copies. In practice: you don’t
          add or collect GST on this invoice — the client accounts for it and pays it directly to the tax authority.
        </Banner>

        <Panel title="Client and dates">
          <FormGrid>
            <Field label="Client" required>
              <select
                value={clientId}
                onChange={(e) => {
                  const id = e.target.value;
                  setClientId(id);
                  const c = clients.find((x) => x.id === id);
                  if (c)
                    setForm((f) => ({
                      ...f,
                      dueDate: new Date(Date.now() + c.creditDays * 86_400_000).toISOString().slice(0, 10),
                    }));
                }}
              >
                <option value="">Select</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
          <DataTable
            columns={columns}
            rows={billable}
            rowKey={(r) => r.id}
            empty="No delivered unbilled consignments for this client."
          />
        </Panel>

        <Panel title="Charges">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            These are the <strong>billed</strong> values from charge capture, not the cost paid to the
            transporter. They appear only where the client’s arrangement provides for them.
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
          <p className="muted" style={{ fontSize: 11.5 }}>
            Rounding to the rupee happens here and only here. Every upstream figure stayed exact in paise.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => submit(false)} disabled={busy || !clientId}>
              Save draft
            </button>
            <button className="btn" onClick={() => submit(true)} disabled={busy || !clientId || chosen.length === 0}>
              Generate invoice
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

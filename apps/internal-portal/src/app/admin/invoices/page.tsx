'use client';

import Link from 'next/link';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/apis';
import { getConfig } from '@/app/admin/apis';
import type { CompanyDetails } from '@/app/admin/types';
import { listClients } from '@/app/clients/apis';
import type { Client } from '@/app/clients/types';
import { createManualInvoice, createManualInvoices, getInvoice, updateManualInvoice } from '@/app/invoices/apis';
import type { Invoice } from '@/app/invoices/types';
import { TaxInvoiceSheet } from '@/components/tax-invoice-sheet';
import { downloadCsv } from '@/lib/export-csv';
import { inr } from '@/lib/format';
import {
  BULK_COLUMNS,
  type BulkKey,
  type BulkRow,
  GST_STATES,
  MANUAL_UNITS,
  type ManualInvoiceInput,
  RCM_RATES,
  type TaxPaidBy,
  addDays,
  amountInWords,
  billToOf,
  bulkRowToInput,
  bulkRowsFromCsv,
  checkManualInvoice,
  gstState,
  lineAmountPaise,
  manualTotals,
  reverseChargeTax,
} from '@/lib/manual-invoice';
import {
  Banner,
  CityField,
  EmptyState,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  StageTabs,
  Tag,
  useRole,
  useToast,
} from '@/lib/ui';

const today = () => new Date().toISOString().slice(0, 10);
const rupees = (v: string) => Math.round((Number(String(v).replace(/[₹,\s]/g, '')) || 0) * 100);
const asRupees = (paise: number) => (paise ? String(paise / 100) : '');

/** The form as typed — money and weight as text until saved. */
interface SingleForm {
  clientId: string;
  invoiceDate: string;
  dueDate: string;
  clientRef: string;
  billTo: { name: string; address: string; gstin: string; state: string };
  placeOfSupply: string;
  consignor: { name: string; address: string; gstin: string };
  consignee: { name: string; address: string; gstin: string };
  vehicleNo: string;
  lrNo: string;
  lrDate: string;
  fromPlace: string;
  toPlace: string;
  goods: string;
  packages: string;
  grossWeightKg: string;
  taxPaidBy: TaxPaidBy;
  rcmRatePct: number;
  items: { description: string; sac: string; qty: string; unit: string; rate: string }[];
  charges: { label: string; amount: string }[];
  notes: string;
}

const party = () => ({ name: '', address: '', gstin: '' });
const BLANK: SingleForm = {
  clientId: '',
  invoiceDate: today(),
  dueDate: '',
  clientRef: '',
  billTo: { ...party(), state: '' },
  placeOfSupply: '',
  consignor: party(),
  consignee: party(),
  vehicleNo: '',
  lrNo: '',
  lrDate: '',
  fromPlace: '',
  toPlace: '',
  goods: '',
  packages: '',
  grossWeightKg: '',
  taxPaidBy: 'BILL_TO',
  rcmRatePct: 5,
  items: [{ description: '', sac: '', qty: '1', unit: 'Trip', rate: '' }],
  charges: [],
  notes: '',
};

function toInput(f: SingleForm): ManualInvoiceInput {
  return {
    clientId: f.clientId,
    invoiceDate: f.invoiceDate,
    dueDate: f.dueDate,
    clientRef: f.clientRef,
    billTo: f.billTo,
    placeOfSupply: f.placeOfSupply,
    consignor: f.consignor,
    consignee: f.consignee,
    vehicleNo: f.vehicleNo,
    lrNo: f.lrNo,
    lrDate: f.lrDate,
    fromPlace: f.fromPlace,
    toPlace: f.toPlace,
    goods: f.goods,
    packages: f.packages,
    grossWeightKg: Number(f.grossWeightKg.replace(/[,\s]/g, '')) || 0,
    taxPaidBy: f.taxPaidBy,
    rcmRatePct: f.rcmRatePct,
    items: f.items.map((i) => ({ description: i.description, sac: i.sac, qty: Number(i.qty) || 0, unit: i.unit, ratePaise: rupees(i.rate) })),
    extraCharges: f.charges.filter((c) => c.label.trim() || c.amount.trim()).map((c) => ({ label: c.label, amountPaise: rupees(c.amount) })),
    notes: f.notes,
  };
}

function fromInvoice(inv: Invoice): SingleForm {
  const m = inv.manual!;
  return {
    clientId: inv.clientId,
    invoiceDate: inv.invoiceDate.slice(0, 10),
    dueDate: inv.dueDate.slice(0, 10),
    clientRef: m.clientRef ?? '',
    billTo: { name: m.billTo.name, address: m.billTo.address ?? '', gstin: m.billTo.gstin ?? '', state: m.billTo.state },
    placeOfSupply: m.placeOfSupply,
    consignor: { name: m.consignor.name, address: m.consignor.address ?? '', gstin: m.consignor.gstin ?? '' },
    consignee: { name: m.consignee.name, address: m.consignee.address ?? '', gstin: m.consignee.gstin ?? '' },
    vehicleNo: m.vehicleNo,
    lrNo: m.lrNo ?? '',
    lrDate: m.lrDate ?? '',
    fromPlace: m.fromPlace,
    toPlace: m.toPlace,
    goods: m.goods,
    packages: m.packages ?? '',
    grossWeightKg: String(m.grossWeightKg),
    taxPaidBy: m.taxPaidBy,
    rcmRatePct: m.rcmRatePct,
    items: m.items.map((i) => ({ description: i.description, sac: i.sac ?? '', qty: String(i.qty), unit: i.unit, rate: asRupees(i.ratePaise) })),
    charges: inv.extraCharges.map((c) => ({ label: c.label, amount: asRupees(c.amountPaise) })),
    notes: inv.notes ?? '',
  };
}

/**
 * Control → Manual invoices — `/admin/invoices`. An administrator builds a GST
 * tax invoice by hand, for work that never ran through the system as a load,
 * or a whole batch of them from a sheet. They are numbered from the same
 * NEX-INV series and land in Client bills and Receivables like any other.
 */
export default function ManualInvoicesPage() {
  const role = useRole();
  const [tab, setTab] = useState<'single' | 'bulk'>('single');
  const [clients, setClients] = useState<Client[] | null>(null);
  const [company, setCompany] = useState<CompanyDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Invoice | null>(null);

  const load = () => {
    setError(null);
    const editId = new URLSearchParams(window.location.search).get('id');
    Promise.all([listClients(), getConfig(), editId ? getInvoice(editId) : Promise.resolve(null)])
      .then(([c, cfg, inv]) => {
        setClients(c);
        setCompany(cfg.company);
        if (inv?.manual) setEditing(inv);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  return (
    <ModuleGuard module="admin">
      <PageHeader
        title={editing ? `Change ${editing.code ?? 'draft invoice'}` : 'Manual invoices'}
        sub="Build a GST tax invoice by hand — one at a time, or a whole sheet at once"
        module="admin"
        right={
          <Link href="/invoices" className="btn btn-secondary">
            Client bills
          </Link>
        }
      />
      <PageIntro
        what="For work billed outside a load on the system. Every invoice carries what a goods transport agency's tax invoice must: both GSTINs and states, place of supply, the consignment (consignor, consignee, truck, route, goods, gross weight), lines with SAC, and the GST the recipient pays under reverse charge. They are numbered from the same series as every other invoice and show up in Client bills and Receivables."
        who="Administrators."
      />
      {role !== 'ADMIN' ? (
        <EmptyState emoji="🔒" title="Only an administrator builds invoices by hand" hint="Invoices for loads on the system are raised from Client bills → New invoice." />
      ) : error ? (
        <ErrorState message={error} retry={load} />
      ) : !clients || !company ? (
        <Loading what="Loading clients and company details" />
      ) : editing ? (
        <SingleBuilder clients={clients} company={company} editing={editing} />
      ) : (
        <Stack>
          <StageTabs
            tabs={[
              { key: 'single', label: '🧾 Single invoice' },
              { key: 'bulk', label: '📚 Bulk invoices' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as 'single' | 'bulk')}
          />
          {tab === 'single' ? <SingleBuilder clients={clients} company={company} /> : <BulkBuilder clients={clients} />}
        </Stack>
      )}
    </ModuleGuard>
  );
}

/* ================================================================ single === */

function SingleBuilder({ clients, company, editing }: { clients: Client[]; company: CompanyDetails; editing?: Invoice }) {
  const toast = useToast();
  const [f, setF] = useState<SingleForm>(() => (editing ? fromInvoice(editing) : BLANK));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Invoice | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const set = (patch: Partial<SingleForm>) => setF((x) => ({ ...x, ...patch }));

  const input = useMemo(() => toInput(f), [f]);
  const problems = useMemo(() => checkManualInvoice(input), [input]);
  const totals = manualTotals(input.items, input.extraCharges);
  const tax = reverseChargeTax(totals.subTotalPaise, f.rcmRatePct, company.gstin, f.placeOfSupply);
  const isDraft = !editing || editing.status === 'DRAFT';

  const pickClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return set({ clientId: '' });
    const billTo = billToOf(c);
    setF((x) => ({
      ...x,
      clientId: id,
      billTo,
      placeOfSupply: billTo.state,
      // The client usually ships it themselves; change it when they do not.
      consignor: x.consignor.name ? x.consignor : { name: billTo.name, address: billTo.address, gstin: billTo.gstin },
      dueDate: addDays(x.invoiceDate || today(), c.creditDays ?? 0),
    }));
  };

  const save = async (issue: boolean) => {
    setBusy(true);
    try {
      const inv = editing ? await updateManualInvoice(editing.id, input, issue) : await createManualInvoice(input, issue);
      setDone(inv);
      toast(inv.code ? `${inv.code} generated` : 'Saved as a draft');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Banner tone="mint" emoji="✅" title={done.code ? `Invoice ${done.code} generated` : 'Saved as a draft — not numbered yet'}>
        {done.clientName} · {inr(done.totalPaise)}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Link href={`/invoices/${done.id}`} className="btn btn-sm">
            Open the invoice
          </Link>
          <Link href={`/print/invoice/${done.id}`} className="btn btn-secondary btn-sm" target="_blank">
            Print / save as PDF
          </Link>
          {!editing && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDone(null); setF(BLANK); }}>
              Build another
            </button>
          )}
        </div>
      </Banner>
    );
  }

  const partyFields = (who: 'consignor' | 'consignee', title: string) => (
    <>
      <Field label={`${title} name`} required>
        <input value={f[who].name} onChange={(e) => set({ [who]: { ...f[who], name: e.target.value } } as Partial<SingleForm>)} />
      </Field>
      <Field label={`${title} GSTIN`} hint="Needed if they pay the GST.">
        <input value={f[who].gstin} maxLength={15} onChange={(e) => set({ [who]: { ...f[who], gstin: e.target.value.toUpperCase() } } as Partial<SingleForm>)} />
      </Field>
      <Field label={`${title} address`}>
        <input value={f[who].address} onChange={(e) => set({ [who]: { ...f[who], address: e.target.value } } as Partial<SingleForm>)} />
      </Field>
    </>
  );

  const stateSelect = (value: string, onChange: (v: string) => void) => (
    <select value={gstState(value)?.name ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose the state</option>
      {GST_STATES.map((s) => (
        <option key={s.code} value={s.name}>
          {s.name} ({s.code})
        </option>
      ))}
    </select>
  );

  return (
    <Stack>
      <Panel title="1 · Client and dates">
        <FormGrid>
          <Field label="Client" required hint={editing && !isDraft ? 'An issued invoice stays with its client.' : 'Fills the bill-to block, place of supply and due date from their record.'}>
            <select value={f.clientId} onChange={(e) => pickClient(e.target.value)} disabled={!!editing && !isDraft}>
              <option value="">Choose a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invoice date" required>
            <input type="date" value={f.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} />
          </Field>
          <Field label="Due date" required>
            <input type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </Field>
          <Field label="Client PO / reference">
            <input value={f.clientRef} onChange={(e) => set({ clientRef: e.target.value })} placeholder="PO-4471" />
          </Field>
        </FormGrid>
      </Panel>

      <Panel title="2 · Bill to (the recipient)">
        <FormGrid>
          <Field label="Name" required>
            <input value={f.billTo.name} onChange={(e) => set({ billTo: { ...f.billTo, name: e.target.value } })} />
          </Field>
          <Field label="GSTIN">
            <input value={f.billTo.gstin} maxLength={15} onChange={(e) => set({ billTo: { ...f.billTo, gstin: e.target.value.toUpperCase() } })} />
          </Field>
          <Field label="State" required>
            {stateSelect(f.billTo.state, (v) => set({ billTo: { ...f.billTo, state: v } }))}
          </Field>
          <Field label="Place of supply" required hint="Decides CGST + SGST (same state as us) or IGST.">
            {stateSelect(f.placeOfSupply, (v) => set({ placeOfSupply: v }))}
          </Field>
        </FormGrid>
        <Field label="Address" required>
          <textarea rows={2} value={f.billTo.address} onChange={(e) => set({ billTo: { ...f.billTo, address: e.target.value } })} />
        </Field>
      </Panel>

      <Panel title="3 · The consignment">
        <FormGrid>
          {partyFields('consignor', 'Consignor')}
          {partyFields('consignee', 'Consignee')}
          <Field label="Vehicle number" required>
            <input value={f.vehicleNo} onChange={(e) => set({ vehicleNo: e.target.value.toUpperCase() })} placeholder="KA 01 AB 4321" />
          </Field>
          <Field label="LR / GC note number">
            <input value={f.lrNo} onChange={(e) => set({ lrNo: e.target.value })} />
          </Field>
          <Field label="LR date">
            <input type="date" value={f.lrDate} onChange={(e) => set({ lrDate: e.target.value })} />
          </Field>
          <Field label="From (place of origin)" required>
            <CityField listId="mi-from" value={f.fromPlace} onChange={(e) => set({ fromPlace: e.target.value })} />
          </Field>
          <Field label="To (destination)" required>
            <CityField listId="mi-to" value={f.toPlace} onChange={(e) => set({ toPlace: e.target.value })} />
          </Field>
          <Field label="Description of goods" required>
            <input value={f.goods} onChange={(e) => set({ goods: e.target.value })} placeholder="Steel coils" />
          </Field>
          <Field label="Packages">
            <input value={f.packages} onChange={(e) => set({ packages: e.target.value })} placeholder="12 coils" />
          </Field>
          <Field label="Gross weight (kg)" required>
            <input inputMode="decimal" value={f.grossWeightKg} onChange={(e) => set({ grossWeightKg: e.target.value })} placeholder="21000" />
          </Field>
        </FormGrid>
      </Panel>

      <Panel title="4 · What is billed">
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th>Description of service</th>
                <th style={{ width: 80 }}>SAC</th>
                <th style={{ width: 56 }}>Qty</th>
                <th style={{ width: 82 }}>Unit</th>
                <th style={{ width: 100 }}>Rate (₹)</th>
                <th style={{ width: 104, textAlign: 'right' }}>Amount</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {f.items.map((it, i) => {
                const upd = (patch: Partial<SingleForm['items'][number]>) => set({ items: f.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <tr key={i}>
                    <td>
                      <input aria-label={`Line ${i + 1} description`} value={it.description} onChange={(e) => upd({ description: e.target.value })} placeholder={`Freight, ${f.fromPlace || 'from'} to ${f.toPlace || 'to'}`} style={{ width: '100%' }} />
                    </td>
                    <td>
                      <input aria-label={`Line ${i + 1} SAC`} value={it.sac} onChange={(e) => upd({ sac: e.target.value.replace(/\D/g, '') })} placeholder={company.sac || '996511'} style={{ width: '100%' }} />
                    </td>
                    <td>
                      <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={it.qty} onChange={(e) => upd({ qty: e.target.value })} style={{ width: '100%' }} />
                    </td>
                    <td>
                      <select aria-label={`Line ${i + 1} unit`} value={it.unit} onChange={(e) => upd({ unit: e.target.value })}>
                        {MANUAL_UNITS.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={it.rate} onChange={(e) => upd({ rate: e.target.value })} style={{ width: '100%' }} />
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {inr(lineAmountPaise(Number(it.qty) || 0, rupees(it.rate)))}
                    </td>
                    <td>
                      {f.items.length > 1 && (
                        <button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove line ${i + 1}`} onClick={() => set({ items: f.items.filter((_, j) => j !== i) })}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {f.charges.map((c, i) => {
                const upd = (patch: Partial<SingleForm['charges'][number]>) => set({ charges: f.charges.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <tr key={`c${i}`}>
                    <td colSpan={4}>
                      <input aria-label={`Charge ${i + 1} name`} value={c.label} onChange={(e) => upd({ label: e.target.value })} placeholder="Loading charges" style={{ width: '100%' }} />
                    </td>
                    <td>
                      <input aria-label={`Charge ${i + 1} amount`} inputMode="decimal" value={c.amount} onChange={(e) => upd({ amount: e.target.value })} style={{ width: '100%' }} />
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {inr(rupees(c.amount))}
                    </td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove charge ${i + 1}`} onClick={() => set({ charges: f.charges.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ items: [...f.items, { description: '', sac: '', qty: '1', unit: 'Trip', rate: '' }] })}>
            ➕ Add a line
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ charges: [...f.charges, { label: '', amount: '' }] })}>
            ➕ Add a charge (loading, detention…)
          </button>
        </div>
      </Panel>

      <Panel title="5 · GST and notes">
        <FormGrid>
          <Field label="GST paid by (reverse charge)" required hint="Their GSTIN is printed as the person liable to pay the tax.">
            <select value={f.taxPaidBy} onChange={(e) => set({ taxPaidBy: e.target.value as TaxPaidBy })}>
              <option value="BILL_TO">The recipient (bill to)</option>
              <option value="CONSIGNOR">The consignor</option>
              <option value="CONSIGNEE">The consignee</option>
            </select>
          </Field>
          <Field label="GST rate" required>
            <select value={f.rcmRatePct} onChange={(e) => set({ rcmRatePct: Number(e.target.value) })}>
              {RCM_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>
        <Field label="Notes printed on the invoice">
          <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </Panel>

      <Panel title="Total">
        <div style={{ display: 'grid', gap: 4 }}>
          <div>
            Taxable value <b className="mono">{inr(totals.subTotalPaise)}</b>
            {totals.roundOffPaise !== 0 && <span className="muted"> · round off {inr(totals.roundOffPaise)}</span>}
          </div>
          <div style={{ fontSize: 18 }}>
            Invoice total <b className="mono" data-testid="manual-total">{inr(totals.totalPaise)}</b>
          </div>
          <div className="muted">{amountInWords(totals.totalPaise)}</div>
          <div className="muted">
            GST the recipient pays under reverse charge, not added: {inr(tax.taxPaise)} ({tax.interState ? `IGST ${f.rcmRatePct}%` : `CGST ${f.rcmRatePct / 2}% + SGST ${f.rcmRatePct / 2}%`})
          </div>
        </div>
        {problems.length > 0 && (
          <div style={{ marginTop: 12 }} data-testid="manual-problems">
            <b>Still needed before it can be saved:</b>
            <ul style={{ margin: '4px 0 0 18px' }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? 'Hide the preview' : '👁️ Preview the invoice'}
          </button>
          {isDraft && (
            <button type="button" className="btn btn-secondary" disabled={busy || problems.length > 0} onClick={() => save(false)}>
              Save as draft
            </button>
          )}
          {editing && !isDraft && (
            <button type="button" className="btn" disabled={busy || problems.length > 0} onClick={() => save(false)}>
              Save changes
            </button>
          )}
          {isDraft && (
            <button type="button" className="btn" disabled={busy || problems.length > 0} onClick={() => save(true)}>
              {busy ? 'Working…' : '🧾 Generate invoice'}
            </button>
          )}
        </div>
      </Panel>

      {showPreview && (
        <div style={{ background: '#fff', padding: 16, borderRadius: 8, overflowX: 'auto' }} data-testid="manual-preview">
          <TaxInvoiceSheet
            invoice={{
              code: editing?.code ?? null,
              status: editing?.status ?? 'DRAFT',
              invoiceDate: f.invoiceDate,
              dueDate: f.dueDate,
              receivedPaise: 0,
              notes: f.notes,
              company,
              extraCharges: input.extraCharges ?? [],
              manual: {
                ...input,
                billTo: { ...input.billTo },
                items: input.items.map((i) => ({ ...i, amountPaise: lineAmountPaise(i.qty, i.ratePaise) })),
              },
            }}
          />
        </div>
      )}
    </Stack>
  );
}

/* ================================================================== bulk === */

const BLANK_ROWS = (): BulkRow[] => [{ invoiceDate: today(), qty: '1', unit: 'Trip', gstRate: '5' }];

function BulkBuilder({ clients }: { clients: Client[] }) {
  const toast = useToast();
  const [rows, setRows] = useState<BulkRow[]>(BLANK_ROWS);
  const [note, setNote] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Invoice[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checked = useMemo(
    () =>
      rows.map((r) => {
        const input = bulkRowToInput(r, clients);
        const problems = checkManualInvoice(input);
        if (r.client && !input.clientId) problems.unshift(`No client called “${r.client}”`);
        return { input, problems };
      }),
    [rows, clients],
  );
  const ready = checked.filter((c) => c.problems.length === 0).length;
  const grand = checked.reduce((a, c) => a + manualTotals(c.input.items, c.input.extraCharges).totalPaise, 0);

  const setCell = (i: number, key: BulkKey, value: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const template = () =>
    downloadCsv(
      'manual-invoices-template.csv',
      BULK_COLUMNS.map((c) => c.header),
      [BULK_COLUMNS.map((c) => (c.key === 'client' ? (clients[0]?.code ?? c.example) : c.example))],
    );

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setNote('Save the sheet as CSV first (Excel: File → Save as → CSV UTF-8), then upload that.');
      return;
    }
    const { rows: read, unknownHeaders } = bulkRowsFromCsv(await file.text());
    if (read.length === 0) {
      setNote('That file has no rows under its header line.');
      return;
    }
    setRows(read);
    setMade(null);
    setServerError(null);
    setNote(
      `${read.length} row${read.length === 1 ? '' : 's'} read from ${file.name}.` +
        (unknownHeaders.length ? ` Columns not used: ${unknownHeaders.join(', ')}.` : ''),
    );
  };

  const generate = async (issue: boolean) => {
    setBusy(true);
    setServerError(null);
    try {
      const out = await createManualInvoices(checked.map((c) => c.input), issue);
      setMade(out);
      toast(issue ? `${out.length} invoices generated` : `${out.length} drafts saved`);
    } catch (e) {
      setServerError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    const ids = made.map((m) => m.id).join(',');
    return (
      <Panel
        title={`${made.length} invoice${made.length === 1 ? '' : 's'} ${made[0]?.code ? 'generated' : 'saved as drafts'}`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/print/invoices?ids=${ids}`} className="btn btn-sm" target="_blank">
              🖨️ Print all / save as one PDF
            </Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMade(null); setRows(BLANK_ROWS()); }}>
              Start another batch
            </button>
          </div>
        }
        pad={false}
      >
        <table className="table" data-testid="bulk-made">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {made.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.code ?? 'Draft'}</td>
                <td>{m.clientName}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {inr(m.totalPaise)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/invoices/${m.id}`} className="btn btn-secondary btn-sm">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    );
  }

  return (
    <Stack>
      <Panel
        title="Each row is one invoice"
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={template}>
              ⬇️ Download the template
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
              ⬆️ Upload a CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={upload} data-testid="bulk-file" />
          </div>
        }
      >
        <div className="hint">
          Fill the grid, or download the template, fill it in Excel or Google Sheets, save it as CSV and upload it. Leave the
          bill-to, place of supply and due date out and they come from the client&rsquo;s record; leave the consignor out and it is
          the client. Columns marked * are needed on every row.
        </div>
        {note && <div className="hint" style={{ marginTop: 6 }}>{note}</div>}
      </Panel>

      <div style={{ overflowX: 'auto' }} className="surface">
        <table className="table" data-testid="bulk-grid" style={{ minWidth: BULK_COLUMNS.reduce((a, c) => a + c.width, 260) }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th style={{ width: 190 }}>Ready?</th>
              {BULK_COLUMNS.map((c) => (
                <th key={c.key} style={{ width: c.width }}>
                  {c.header}
                  {c.need ? ' *' : ''}
                </th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {checked[i].problems.length === 0 ? (
                    <Tag tone="mint">Ready · {inr(manualTotals(checked[i].input.items, checked[i].input.extraCharges).totalPaise)}</Tag>
                  ) : (
                    <span style={{ color: 'var(--red)', fontSize: 11.5 }} title={checked[i].problems.join('\n')}>
                      ⚠ {checked[i].problems[0]}
                      {checked[i].problems.length > 1 ? ` (+${checked[i].problems.length - 1} more)` : ''}
                    </span>
                  )}
                </td>
                {BULK_COLUMNS.map((c) => (
                  <td key={c.key}>
                    <input
                      aria-label={`Row ${i + 1} ${c.header}`}
                      value={r[c.key] ?? ''}
                      onChange={(e) => setCell(i, c.key, e.target.value)}
                      list={c.key === 'client' ? 'bulk-clients' : undefined}
                      type={c.key === 'invoiceDate' || c.key === 'dueDate' || c.key === 'lrDate' ? 'date' : 'text'}
                      style={{ width: '100%' }}
                    />
                  </td>
                ))}
                <td>
                  {rows.length > 1 && (
                    <button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="bulk-clients">
          {clients.map((c) => (
            <option key={c.id} value={c.code}>
              {c.name}
            </option>
          ))}
        </datalist>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setRows([...rows, { invoiceDate: rows[rows.length - 1]?.invoiceDate ?? today(), qty: '1', unit: 'Trip', gstRate: '5' }])}>
          ➕ Add a row
        </button>
        <span className="muted" data-testid="bulk-summary">
          {ready} of {rows.length} ready · {inr(grand)} in all
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-secondary" disabled={busy || ready !== rows.length} onClick={() => generate(false)}>
          Save {rows.length} as drafts
        </button>
        <button type="button" className="btn" disabled={busy || ready !== rows.length} onClick={() => generate(true)}>
          {busy ? 'Working…' : `🧾 Generate ${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {serverError && (
        <Banner tone="red" title="Nothing was created">
          {serverError}
        </Banner>
      )}
    </Stack>
  );
}

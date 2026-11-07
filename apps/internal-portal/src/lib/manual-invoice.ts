/**
 * Manual invoices in the console: the rules shared with the API (what an
 * invoice must carry, its totals, the reverse-charge split, amount in words)
 * plus what only the console does — turning a spreadsheet row into an invoice.
 */
import type { Client } from '@/app/clients/types';
import {
  type ManualInvoiceInput,
  type TaxPaidBy,
  gstState,
  stateOfGstin,
} from '../../../internal-api/src/common/manual-invoice';

export {
  GST_STATES,
  MANUAL_UNITS,
  RCM_RATES,
  amountInWords,
  checkManualInvoice,
  gstState,
  lineAmountPaise,
  liableParty,
  manualDetailsOf,
  manualTotals,
  reverseChargeTax,
  stateOfGstin,
} from '../../../internal-api/src/common/manual-invoice';
export type { ManualDetails, ManualInvoiceInput, ManualItemInput, ManualParty, TaxPaidBy } from '../../../internal-api/src/common/manual-invoice';

/** The bill-to block a client's own record gives — the starting point, changeable per invoice. */
export function billToOf(client: Client) {
  const place = [client.billingCity, client.billingState, client.billingPincode].filter(Boolean).join(', ');
  return {
    name: client.name,
    address: [client.billingAddress, place].filter(Boolean).join(', '),
    gstin: client.gstin ?? '',
    // A record with no billing state still has one: a GSTIN's first two digits.
    state: gstState(client.billingState)?.name ?? stateOfGstin(client.gstin)?.name ?? client.billingState ?? '',
  };
}

export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---- bulk: one spreadsheet row, one invoice -------------------------------- */

/** The columns of the bulk sheet, in order. `need` marks what the sheet itself must give. */
export const BULK_COLUMNS = [
  { key: 'client', header: 'Client (code or name)', need: true, example: 'CLT-0092', width: 150 },
  { key: 'invoiceDate', header: 'Invoice date', need: true, example: '2026-11-07', width: 130 },
  { key: 'dueDate', header: 'Due date', need: false, example: '', width: 130 },
  { key: 'clientRef', header: 'Client PO / reference', need: false, example: 'PO-4471', width: 130 },
  { key: 'consignor', header: 'Consignor', need: false, example: '', width: 160 },
  { key: 'consignorGstin', header: 'Consignor GSTIN', need: false, example: '', width: 160 },
  { key: 'consignee', header: 'Consignee', need: true, example: 'Chennai Fabricators', width: 160 },
  { key: 'consigneeAddress', header: 'Consignee address', need: false, example: 'Ambattur, Chennai', width: 180 },
  { key: 'consigneeGstin', header: 'Consignee GSTIN', need: false, example: '', width: 160 },
  { key: 'vehicleNo', header: 'Vehicle number', need: true, example: 'KA 01 AB 4321', width: 130 },
  { key: 'lrNo', header: 'LR number', need: false, example: 'LR-88215', width: 110 },
  { key: 'lrDate', header: 'LR date', need: false, example: '2026-11-05', width: 130 },
  { key: 'fromPlace', header: 'From', need: true, example: 'Bengaluru', width: 120 },
  { key: 'toPlace', header: 'To', need: true, example: 'Chennai', width: 120 },
  { key: 'goods', header: 'Goods', need: true, example: 'Steel coils', width: 150 },
  { key: 'packages', header: 'Packages', need: false, example: '12 coils', width: 100 },
  { key: 'grossWeightKg', header: 'Gross weight (kg)', need: true, example: '21000', width: 120 },
  { key: 'description', header: 'Line description', need: false, example: '', width: 220 },
  { key: 'sac', header: 'SAC', need: false, example: '996511', width: 90 },
  { key: 'qty', header: 'Qty', need: false, example: '1', width: 70 },
  { key: 'unit', header: 'Unit', need: false, example: 'Trip', width: 80 },
  { key: 'rate', header: 'Rate (₹)', need: true, example: '40000', width: 110 },
  { key: 'loading', header: 'Loading (₹)', need: false, example: '1500', width: 100 },
  { key: 'unloading', header: 'Unloading (₹)', need: false, example: '', width: 100 },
  { key: 'detention', header: 'Detention (₹)', need: false, example: '', width: 100 },
  { key: 'other', header: 'Other charges (₹)', need: false, example: '', width: 110 },
  { key: 'placeOfSupply', header: 'Place of supply (state)', need: false, example: '', width: 150 },
  { key: 'taxPaidBy', header: 'GST paid by (bill to / consignor / consignee)', need: false, example: 'bill to', width: 150 },
  { key: 'gstRate', header: 'GST rate % (5 or 12)', need: false, example: '5', width: 90 },
  { key: 'notes', header: 'Notes', need: false, example: '', width: 200 },
] as const;

export type BulkKey = (typeof BULK_COLUMNS)[number]['key'];
export type BulkRow = Partial<Record<BulkKey, string>>;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** CSV text → rows of cells. Quotes, commas and line breaks inside quotes, CRLF and a BOM are all fine. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * A sheet's rows, by column. Headers are matched loosely — "Vehicle number",
 * "vehicle no" and "vehicleNo" are the same column — and unknown ones are
 * reported rather than silently dropped.
 */
export function bulkRowsFromCsv(text: string): { rows: BulkRow[]; unknownHeaders: string[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], unknownHeaders: [] };
  const alias: Record<string, BulkKey> = { vehicle: 'vehicleNo', vehicleno: 'vehicleNo', truck: 'vehicleNo', truckno: 'vehicleNo', from: 'fromPlace', to: 'toPlace', weight: 'grossWeightKg', grossweight: 'grossWeightKg', amount: 'rate', freight: 'rate', clientcode: 'client', clientname: 'client', lr: 'lrNo', date: 'invoiceDate' };
  const unknownHeaders: string[] = [];
  const keys = head.map((h) => {
    const s = squash(h);
    const col = BULK_COLUMNS.find((c) => squash(c.header) === s || squash(c.key) === s || squash(c.header.replace(/\(.*\)/, '')) === s);
    const key = col?.key ?? alias[s];
    if (!key && h.trim()) unknownHeaders.push(h.trim());
    return key;
  });
  const rows = body.map((cells) => {
    const r: BulkRow = {};
    keys.forEach((k, i) => {
      if (k && cells[i] !== undefined && cells[i].trim() !== '') r[k] = cells[i].trim();
    });
    return r;
  });
  return { rows, unknownHeaders };
}

/** 2026-11-07, 07-11-2026, 07/11/2026 and 7.11.2026 all mean the 7th of November. */
export function isoDayOf(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v;
}

const rupeesToPaise = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

function taxPaidByOf(v: string | undefined): TaxPaidBy {
  const s = squash(v ?? '');
  return s.startsWith('consignor') ? 'CONSIGNOR' : s.startsWith('consignee') ? 'CONSIGNEE' : 'BILL_TO';
}

export function findClient(clients: Client[], codeOrName: string | undefined) {
  const s = squash(codeOrName ?? '');
  if (!s) return undefined;
  return clients.find((c) => squash(c.code) === s) ?? clients.find((c) => squash(c.name) === s);
}

/**
 * One row → one invoice. Whatever the row leaves out comes from the client's
 * own record: the bill-to block and place of supply, the due date from their
 * credit days, and the client as consignor (the usual case — they ship it).
 */
export function bulkRowToInput(row: BulkRow, clients: Client[]): ManualInvoiceInput {
  const client = findClient(clients, row.client);
  const billTo = client ? billToOf(client) : { name: '', address: '', gstin: '', state: '' };
  const invoiceDate = isoDayOf(row.invoiceDate);
  const charges = (
    [
      ['Loading charges', row.loading],
      ['Unloading charges', row.unloading],
      ['Detention charges', row.detention],
      ['Other charges', row.other],
    ] as const
  )
    .filter(([, v]) => v && rupeesToPaise(v) > 0)
    .map(([label, v]) => ({ label, amountPaise: rupeesToPaise(v) }));
  return {
    clientId: client?.id ?? '',
    invoiceDate,
    dueDate: row.dueDate ? isoDayOf(row.dueDate) : invoiceDate && client ? addDays(invoiceDate, client.creditDays ?? 0) : '',
    billTo,
    placeOfSupply: row.placeOfSupply || billTo.state,
    clientRef: row.clientRef ?? '',
    consignor: { name: row.consignor || billTo.name, gstin: row.consignorGstin || (row.consignor ? '' : billTo.gstin), address: row.consignor ? '' : billTo.address },
    consignee: { name: row.consignee ?? '', address: row.consigneeAddress ?? '', gstin: row.consigneeGstin ?? '' },
    vehicleNo: row.vehicleNo ?? '',
    lrNo: row.lrNo ?? '',
    lrDate: row.lrDate ? isoDayOf(row.lrDate) : '',
    fromPlace: row.fromPlace ?? '',
    toPlace: row.toPlace ?? '',
    goods: row.goods ?? '',
    packages: row.packages ?? '',
    grossWeightKg: Number(String(row.grossWeightKg ?? '').replace(/[,\s]/g, '')) || 0,
    taxPaidBy: taxPaidByOf(row.taxPaidBy),
    rcmRatePct: Number(row.gstRate || 5),
    items: [
      {
        description: row.description || `Freight for transportation of ${row.goods || 'goods'} from ${row.fromPlace || '—'} to ${row.toPlace || '—'}`,
        sac: row.sac ?? '',
        qty: Number(row.qty || 1),
        unit: row.unit || 'Trip',
        ratePaise: rupeesToPaise(row.rate),
      },
    ],
    extraCharges: charges,
    notes: row.notes ?? '',
  };
}

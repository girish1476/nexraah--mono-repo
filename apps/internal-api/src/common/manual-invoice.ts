/**
 * A manual invoice — one an administrator fills in by hand, singly or many at
 * once, instead of raising it from trips on the system.
 *
 * Shared by the API (which stores and numbers it) and the console (which
 * previews and prints it), so the figure on the screen is the figure saved.
 * No package imports: the console builds without the API's packages.
 *
 * What it must carry is the law for a goods transport agency's invoice:
 * CGST Rule 46 (supplier and recipient with GSTINs, number and date, place of
 * supply with its state, SAC, quantity, unit, value, whether tax is payable
 * on reverse charge, signature) and Rule 54(3) (gross weight, consignor and
 * consignee, the truck's registration number, the goods, origin and
 * destination, and the GSTIN of whoever pays the tax). The tax itself is
 * reverse charge (BR-15): the invoice charges none, and states what the
 * recipient pays.
 */
import { GSTIN_SHAPE_RE, VEHICLE_RE } from './validation/formats';

/** GST state codes — the first two digits of every GSTIN. */
export const GST_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');

/** The state by its name or its two-digit code, forgiving case, spaces and "&". */
export function gstState(nameOrCode: string | null | undefined) {
  const v = (nameOrCode ?? '').trim();
  if (!v) return undefined;
  if (/^\d{1,2}$/.test(v)) return GST_STATES.find((s) => s.code === v.padStart(2, '0'));
  return GST_STATES.find((s) => norm(s.name) === norm(v)) ?? (norm(v) === 'orissa' ? GST_STATES.find((s) => s.code === '21') : undefined);
}

/** The state a GSTIN is registered in. */
export function stateOfGstin(gstin: string | null | undefined) {
  return gstin && gstin.length >= 2 ? GST_STATES.find((s) => s.code === gstin.slice(0, 2)) : undefined;
}

export const MANUAL_UNITS = ['Trip', 'MT', 'Kg', 'KM', 'Nos', 'Day', 'Hour'] as const;
/** GST on a goods transport agency's service paid by the recipient under reverse charge. */
export const RCM_RATES = [5, 12] as const;
export type TaxPaidBy = 'BILL_TO' | 'CONSIGNOR' | 'CONSIGNEE';

export interface ManualItemInput {
  description: string;
  /** Blank prints the company's SAC. */
  sac?: string;
  qty: number;
  unit: string;
  ratePaise: number;
}

export interface ManualParty {
  name: string;
  address?: string;
  gstin?: string;
}

export interface ManualDetails {
  billTo: ManualParty & { state: string };
  /** State name; its code is printed beside it. */
  placeOfSupply: string;
  /** The client's PO or reference, if they gave one. */
  clientRef?: string;
  consignor: ManualParty;
  consignee: ManualParty;
  vehicleNo: string;
  lrNo?: string;
  lrDate?: string;
  fromPlace: string;
  toPlace: string;
  goods: string;
  packages?: string;
  grossWeightKg: number;
  taxPaidBy: TaxPaidBy;
  rcmRatePct: number;
  items: (ManualItemInput & { amountPaise: number })[];
}

/** What a form or a spreadsheet row sends. */
export interface ManualInvoiceInput extends Omit<ManualDetails, 'items'> {
  clientId: string;
  invoiceDate: string;
  dueDate: string;
  items: ManualItemInput[];
  extraCharges?: { label: string; amountPaise: number }[];
  notes?: string;
}

export function lineAmountPaise(qty: number, ratePaise: number): number {
  return Math.round((Number(qty) || 0) * (Number(ratePaise) || 0));
}

/** Rounded to the rupee exactly as every other invoice is (NFR-09). */
export function manualTotals(items: ManualItemInput[], extraCharges: { amountPaise: number }[] = []) {
  const itemsPaise = items.reduce((a, i) => a + lineAmountPaise(i.qty, i.ratePaise), 0);
  const chargesPaise = extraCharges.reduce((a, c) => a + (Number(c.amountPaise) || 0), 0);
  const subTotalPaise = itemsPaise + chargesPaise;
  const totalPaise = Math.round(subTotalPaise / 100) * 100;
  return { itemsPaise, chargesPaise, subTotalPaise, roundOffPaise: totalPaise - subTotalPaise, totalPaise };
}

/**
 * The tax the recipient pays under reverse charge — never added to the total.
 * Within the supplier's own state it is half CGST and half SGST; across states, IGST.
 */
export function reverseChargeTax(taxablePaise: number, ratePct: number, supplierGstin: string | null | undefined, placeOfSupply: string) {
  const from = stateOfGstin(supplierGstin)?.code;
  const to = gstState(placeOfSupply)?.code;
  const taxPaise = Math.round((taxablePaise * ratePct) / 100);
  if (from && to && from === to) {
    const half = Math.round(taxPaise / 2);
    return { interState: false, cgstPaise: half, sgstPaise: taxPaise - half, igstPaise: 0, taxPaise };
  }
  return { interState: true, cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise, taxPaise };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function below1000(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}
/** Indian grouping: crore, lakh, thousand, hundred. */
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "Rupees Forty Thousand Only", with paise when there are any. */
export function amountInWords(paise: number): string {
  const p = Math.round(Math.abs(paise));
  const rupees = Math.floor(p / 100);
  const rest = p % 100;
  return `Rupees ${indianWords(rupees)}${rest ? ` and ${below100(rest)} Paise` : ''} Only`;
}

/** The GSTIN of whoever pays the tax, as Rule 54(3) asks for it. */
export function liableParty(d: Pick<ManualDetails, 'taxPaidBy' | 'billTo' | 'consignor' | 'consignee'>) {
  const party = d.taxPaidBy === 'CONSIGNOR' ? d.consignor : d.taxPaidBy === 'CONSIGNEE' ? d.consignee : d.billTo;
  const role = d.taxPaidBy === 'CONSIGNOR' ? 'Consignor' : d.taxPaidBy === 'CONSIGNEE' ? 'Consignee' : 'Recipient (bill to)';
  return { role, name: party?.name ?? '', gstin: (party?.gstin ?? '').trim().toUpperCase() };
}

const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything wrong with one invoice, in words for whoever is filling it in —
 * empty when it can be saved. The API refuses on the same list.
 */
export function checkManualInvoice(i: Partial<ManualInvoiceInput>): string[] {
  const p: string[] = [];
  const need = (v: unknown, what: string) => blank(v) && p.push(`${what} is missing`);
  need(i.clientId, 'Client');
  if (blank(i.invoiceDate) || !ISO_DAY.test(String(i.invoiceDate))) p.push('Invoice date is missing or not a date');
  if (blank(i.dueDate) || !ISO_DAY.test(String(i.dueDate))) p.push('Due date is missing or not a date');
  else if (i.invoiceDate && String(i.dueDate) < String(i.invoiceDate)) p.push('Due date is before the invoice date');
  need(i.billTo?.name, 'Bill-to name');
  need(i.billTo?.address, 'Bill-to address');
  if (!gstState(i.billTo?.state)) p.push('Bill-to state is missing or not an Indian state');
  if (!gstState(i.placeOfSupply)) p.push('Place of supply is missing or not an Indian state');
  need(i.consignor?.name, 'Consignor');
  need(i.consignee?.name, 'Consignee');
  if (blank(i.vehicleNo)) p.push('Vehicle number is missing');
  else if (!VEHICLE_RE.test(String(i.vehicleNo).trim())) p.push('Vehicle number does not look like a registration number');
  need(i.fromPlace, 'From (place of origin)');
  need(i.toPlace, 'To (destination)');
  need(i.goods, 'Description of goods');
  if (!(Number(i.grossWeightKg) > 0)) p.push('Gross weight is missing');
  for (const [who, party] of [['Bill-to', i.billTo], ['Consignor', i.consignor], ['Consignee', i.consignee]] as const) {
    const g = (party?.gstin ?? '').trim().toUpperCase();
    if (g && !GSTIN_SHAPE_RE.test(g)) p.push(`${who} GSTIN does not look like a GSTIN`);
  }
  if (i.taxPaidBy && i.billTo && i.consignor && i.consignee && !liableParty(i as ManualDetails).gstin) {
    p.push(`GSTIN of the ${liableParty(i as ManualDetails).role.toLowerCase()} is needed — they pay the GST under reverse charge`);
  }
  if (!RCM_RATES.includes(Number(i.rcmRatePct) as (typeof RCM_RATES)[number])) p.push('GST rate must be 5% or 12%');
  const items = i.items ?? [];
  if (items.length === 0) p.push('Add at least one line');
  items.forEach((it, n) => {
    const at = items.length > 1 ? ` on line ${n + 1}` : '';
    if (blank(it.description)) p.push(`Description is missing${at}`);
    if (!(Number(it.qty) > 0)) p.push(`Quantity is missing${at}`);
    if (blank(it.unit)) p.push(`Unit is missing${at}`);
    if (!(Number(it.ratePaise) > 0)) p.push(`Rate is missing${at}`);
    if (!blank(it.sac) && !/^\d{4,8}$/.test(String(it.sac).trim())) p.push(`SAC must be 4 to 8 digits${at}`);
  });
  for (const c of i.extraCharges ?? []) {
    if (blank(c.label) || !(Number(c.amountPaise) >= 0)) p.push('Every extra charge needs a name and an amount');
  }
  return p;
}

/** What is stored with the invoice: the details, tidied, with each line's amount worked out. */
export function manualDetailsOf(i: ManualInvoiceInput): ManualDetails {
  const t = (v: string | undefined) => (v ?? '').trim();
  const party = (x: ManualParty): ManualParty => ({ name: t(x.name), address: t(x.address), gstin: t(x.gstin).toUpperCase() });
  return {
    billTo: { ...party(i.billTo), state: gstState(i.billTo.state)?.name ?? t(i.billTo.state) },
    placeOfSupply: gstState(i.placeOfSupply)?.name ?? t(i.placeOfSupply),
    clientRef: t(i.clientRef),
    consignor: party(i.consignor),
    consignee: party(i.consignee),
    vehicleNo: t(i.vehicleNo).toUpperCase(),
    lrNo: t(i.lrNo),
    lrDate: t(i.lrDate),
    fromPlace: t(i.fromPlace),
    toPlace: t(i.toPlace),
    goods: t(i.goods),
    packages: t(i.packages),
    grossWeightKg: Number(i.grossWeightKg),
    taxPaidBy: i.taxPaidBy ?? 'BILL_TO',
    rcmRatePct: Number(i.rcmRatePct),
    items: i.items.map((it) => ({
      description: t(it.description),
      sac: t(it.sac),
      qty: Number(it.qty),
      unit: t(it.unit),
      ratePaise: Math.round(Number(it.ratePaise)),
      amountPaise: lineAmountPaise(it.qty, it.ratePaise),
    })),
  };
}

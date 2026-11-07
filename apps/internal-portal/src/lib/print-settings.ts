/**
 * What is printed on the lorry receipt and the invoice that the company words
 * for itself: the names of the lorry receipt's copies, and the terms and
 * conditions on each document.
 *
 * These were fixed in the code, so changing "Carrier copy" to "Driver copy", or
 * putting the company's own terms on the receipt, meant a change to the
 * console. They are settings now (Admin → Control panel → Printed documents).
 * Until somebody sets them, what was printed before is printed still.
 */

/**
 * The four copies of the company's own lorry receipt book (Nexus Freight, Nov
 * 2026): one for the shipper, one that travels to the consignee, and the two
 * that come back signed as proof of delivery.
 */
export const DEFAULT_LR_COPIES = ['Shipper copy', 'Consignee copy', 'POD copy', 'POD duplicate'];

/**
 * The terms printed on the back of every copy — the company's own, as on its
 * printed LR book. A line starting with "# " is a heading; every other line is
 * one point under it. One drafting note on the paper is left out: "(insert
 * exact number as policy)" after the 30-day claim window. Typos are mended.
 */
export const DEFAULT_LR_TERMS = [
  '# Risk and insurance',
  "All consignments are carried at Owner's risk unless expressly endorsed as Carrier's Risk on the LR; if not struck off, it shall be deemed Carrier's Risk as per standard practice.",
  'Nature, content, condition and value of the goods are as declared by the consignor and shall be treated as true; consignor is solely responsible for any incorrect/false declaration and its consequences.',
  'Consignor/consignee must arrange adequate transit insurance for goods at their own cost; Nexraah shall not be responsible for uninsured loss or shortfall in insurance cover.',
  '# Packing, documentation and compliance',
  'Goods must be properly packed, stowed and fit for road transport; Nexraah is not liable for internal damage, leakage, breakage or deterioration if packages are delivered in the same apparent condition as booked.',
  'Consignor must provide all required and valid documents, permits, e-way bills and comply with all applicable laws; Nexraah is not liable for detention, seizure or confiscation of goods by authorities due to incorrect declaration or non-compliance.',
  "Prohibited, hazardous, contraband or banned goods shall not be tendered; Nexraah shall have no liability for such goods and any penalties, claims or losses arising therefrom shall be to consignor's account.",
  '# Liability, exclusions and force majeure',
  'Nexraah is not liable for loss, damage, shortage, theft, pilferage, hijacking or leakage arising from causes beyond its control including but not limited to accident, fire, rain, floods, acts of God, riots, strikes, civil commotion, road blocks, vehicle breakdown, acts of thieves, robbers or similar events.',
  "Where goods are lost, destroyed, damaged or deteriorated due to Nexraah's proven negligence (under Carrier's Risk), compensation shall not exceed the declared value/freight as may be contractually agreed, and in any case shall be subject to the Carriage by Road Act 2007 and Rules 2011.",
  'Nexraah shall not be responsible for any consequential, indirect or special loss, including loss of profit, business or market, due to delay, damage, non-delivery or mis-delivery of the consignment.',
  '# Transit, delivery, claims and demurrage',
  'Nexraah does not guarantee delivery within any specific time and is not liable for delays due to road conditions, non-availability of vehicles, route closure, operational reasons or force majeure.',
  'Nexraah may transship or shift the consignment to another vehicle/route in case of accident, breakdown, seizure or operational necessity, and any reasonable additional cost so incurred shall be chargeable to consignor/consignee.',
  'Consignee must take delivery of goods within 24 hours of vehicle arrival for self/LR-copy delivery; thereafter demurrage/storage charges as per Nexraah tariff will apply.',
  'Responsibility of Nexraah ceases once goods are delivered at the destination address/transport godown and LR/POD is acknowledged; no claims will be entertained after 30 days from date and time of delivery.',
  'Any loss/damage noticed on arrival must be notified in writing on the POD at the time of delivery and separately to Nexraah within 24 hours, with reasonable opportunity for joint survey/inspection; failure to do so discharges Nexraah from liability.',
  '# Freight, lien, sale of goods and jurisdiction',
  'Freight and other charges (including taxes, tolls, loading/unloading, detention, demurrage, additional handling, penalties by authorities etc.) are extra as applicable and are primarily payable by the consignor unless otherwise agreed in writing.',
  'Nexraah shall have a general lien on all goods in its possession for any freight, demurrage, detention, taxes, warehousing or other charges due, and may detain the goods until full payment.',
  'If consignor/consignee fails to take delivery or clear outstanding dues within the stipulated period (e.g., 30 days from invoice), Nexraah may, after reasonable notice as per law, sell/auction the goods and adjust sale proceeds towards its dues, storage and sale expenses; any balance, if any, shall be payable/refundable to the entitled party.',
  'LR is a non-negotiable, non-transferable document except where specifically endorsed to a bank, in which case delivery shall only be made against original LR duly discharged by the bank/holder.',
  'Any dispute arising from this consignment note or the related transport contract shall be resolved through arbitration and/or before the competent courts at Visakhapatnam, Andhra Pradesh, and shall be governed by the laws of India, with all legal proceedings subject exclusively to the jurisdiction of the courts at Visakhapatnam, Andhra Pradesh.',
].join('\n');

export const DEFAULT_INVOICE_TERMS =
  'Confidentiality: Both parties agree to keep all business information and materials confidential.';

/** The most copies a lorry receipt is printed in. */
export const MAX_LR_COPIES = 6;

interface PrintSettings {
  lrCopies?: string[] | null;
  lrTerms?: string | null;
  invoiceTerms?: string | null;
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * The copies to print, in order. A name left empty drops that copy; if every
 * name is empty the receipt is still printed, in the usual four.
 */
export function lrCopies(company: PrintSettings | null | undefined): string[] {
  const named = (company?.lrCopies ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
  return named.length > 0 ? named.slice(0, MAX_LR_COPIES) : DEFAULT_LR_COPIES;
}

/**
 * The lorry receipt's terms, a line at a time. Never set: the terms printed
 * before. Set and then emptied: none — an empty box is a decision to print none.
 */
export function lrTermsLines(company: PrintSettings | null | undefined): string[] {
  return lines(typeof company?.lrTerms === 'string' ? company.lrTerms : DEFAULT_LR_TERMS);
}

/** The invoice's terms, a line at a time — by the same rule. */
export function invoiceTermsLines(company: PrintSettings | null | undefined): string[] {
  return lines(typeof company?.invoiceTerms === 'string' ? company.invoiceTerms : DEFAULT_INVOICE_TERMS);
}

/** One heading and its points — how the lorry receipt prints its terms. */
export interface TermsSection {
  heading: string | null;
  points: string[];
}

/**
 * The terms in sections: a "# " line opens one, every other line is a point
 * in the current one. Terms written without headings come back as a single
 * section with no heading, so an older one-paragraph setting still prints.
 */
export function termsSections(lines: string[]): TermsSection[] {
  const out: TermsSection[] = [];
  for (const line of lines) {
    if (line.startsWith('# ')) out.push({ heading: line.slice(2).trim(), points: [] });
    else if (out.length) out[out.length - 1].points.push(line);
    else out.push({ heading: null, points: [line] });
  }
  return out.filter((s) => s.heading || s.points.length);
}

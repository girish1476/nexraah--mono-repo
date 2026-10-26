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

/** The four copies a lorry receipt is printed in, until the company names its own. */
export const DEFAULT_LR_COPIES = ['Consignor copy', 'Consignee copy', 'Carrier copy', 'Office copy'];

export const DEFAULT_LR_TERMS =
  'Goods are carried at owner’s risk. The carrier is not responsible for leakage, breakage or loss arising from causes beyond its control. ' +
  'Delivery is against production of this receipt and proof of identity. Any claim must be lodged in writing within seven days of delivery. ' +
  'Subject to the jurisdiction of the courts at the booking branch.';

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

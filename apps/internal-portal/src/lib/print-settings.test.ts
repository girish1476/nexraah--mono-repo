import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from '../mocks';
import { invoiceLines, termsLines } from './invoice-layout';
import { buildInvoicePdf } from './invoice-pdf';
import type { RoleCode } from './permissions';
import {
  DEFAULT_INVOICE_TERMS,
  DEFAULT_LR_COPIES,
  DEFAULT_LR_TERMS,
  invoiceTermsLines,
  lrCopies,
  lrTermsLines,
} from './print-settings';

/**
 * What the company words for itself on its printed documents (11 Oct 2026):
 * the names of the lorry receipt's copies, and the terms and conditions on the
 * receipt and the invoice. Unset, what was printed before is printed still.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

describe('the lorry receipt’s copies', () => {
  it('are the usual four until the company names its own', () => {
    expect(lrCopies(undefined)).toEqual(DEFAULT_LR_COPIES);
    expect(lrCopies({})).toEqual(['Consignor copy', 'Consignee copy', 'Carrier copy', 'Office copy']);
  });

  it('take the company’s names, in order; an empty name drops that copy', () => {
    expect(lrCopies({ lrCopies: ['Consignor copy', 'Consignee copy', 'Driver copy', 'Accounts copy'] })).toEqual([
      'Consignor copy',
      'Consignee copy',
      'Driver copy',
      'Accounts copy',
    ]);
    expect(lrCopies({ lrCopies: ['Consignor copy', ' ', 'Driver copy', ''] })).toEqual(['Consignor copy', 'Driver copy']);
  });

  it('are still printed when every name is emptied — a receipt with no copies is no receipt', () => {
    expect(lrCopies({ lrCopies: ['', ' ', '', ''] })).toEqual(DEFAULT_LR_COPIES);
  });
});

describe('terms and conditions', () => {
  it('are the standard ones until set, a line each once set, and none when emptied', () => {
    expect(lrTermsLines({})).toEqual([DEFAULT_LR_TERMS]);
    expect(invoiceTermsLines(null)).toEqual([DEFAULT_INVOICE_TERMS]);
    expect(lrTermsLines({ lrTerms: '1. Goods at owner’s risk.\n\n2. Claims within 7 days.  \n' })).toEqual([
      '1. Goods at owner’s risk.',
      '2. Claims within 7 days.',
    ]);
    expect(lrTermsLines({ lrTerms: '' })).toEqual([]);
    expect(invoiceTermsLines({ invoiceTerms: '   ' })).toEqual([]);
  });

  it('set in the control panel, they are on the next invoice — printed and downloaded', async () => {
    const config = await call('ADMIN', 'GET', '/config');
    const saved = await call('ADMIN', 'PATCH', '/config', {
      company: {
        ...config.company,
        lrCopies: ['Consignor copy', 'Consignee copy', 'Driver copy', 'Accounts copy'],
        lrTerms: '1. Goods are carried at owner’s risk.\n2. Subject to Visakhapatnam jurisdiction.',
        invoiceTerms: '1. Payment within the credit period.\n2. Interest at 18% a year on overdue amounts.',
      },
    });
    expect(lrCopies(saved.company)).toEqual(['Consignor copy', 'Consignee copy', 'Driver copy', 'Accounts copy']);
    expect(lrTermsLines(saved.company)).toHaveLength(2);

    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    expect(termsLines(invoice)).toEqual(['1. Payment within the credit period.', '2. Interest at 18% a year on overdue amounts.']);
    expect(invoiceLines(invoice).length).toBeGreaterThan(0);
    const doc = await buildInvoicePdf(invoice);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('an invoice with its terms emptied still downloads, on one page', async () => {
    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    const doc = await buildInvoicePdf({ ...invoice, company: { ...invoice.company, invoiceTerms: '' } });
    expect(termsLines({ ...invoice, company: { ...invoice.company, invoiceTerms: '' } })).toEqual([]);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

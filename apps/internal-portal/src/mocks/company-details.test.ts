import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { REAL_COMPANY, correctSavedCompany } from './clean-data';
import { addressLines, addressOneLine, companyExtraLines } from '../lib/invoice-layout';
import { buildInvoicePdf } from '../lib/invoice-pdf';
import type { RoleCode } from '../lib/permissions';

/**
 * The company as it is printed (10 Oct 2026): the real name, address and GST
 * number reach a browser that saved the made-up ones; details added in the
 * control panel are printed; and the invoice is one page.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const madeUp = () => ({
  name: 'Nexraah Logistics Private Limited',
  gstin: '27AABCN4471K1ZV',
  pan: 'AABCN4471K',
  cin: 'U63030MH2019PTC332211',
  address: 'Plot 44, MIDC Ambad, Nashik 422010, Maharashtra',
  bank: 'HDFC Bank · Nashik · A/c 50200044714471 · IFSC HDFC0000188',
  sac: '996511',
  signatory: 'Authorised Signatory',
});

describe('a saved copy of the company', () => {
  it('the made-up company is replaced by the real one, keeping what is not part of it', () => {
    const db = { config: { company: { ...madeUp(), signatory: 'K. Rao, Director', extra: [{ label: 'TAN', value: 'VPNN01234A' }] } } };
    correctSavedCompany(db);
    expect(db.config.company).toMatchObject(REAL_COMPANY);
    expect(db.config.company.name).toBe('NEXUS FREIGHT PRIVATE LIMITED');
    expect(db.config.company.gstin).toBe('37AAKCN9322K1ZY');
    expect(db.config.company.sac).toBe('996511');
    expect(db.config.company.signatory).toBe('K. Rao, Director');
    expect(db.config.company.extra).toEqual([{ label: 'TAN', value: 'VPNN01234A' }]);
  });

  it('earlier spellings of the real company are brought up to date', () => {
    const db = {
      config: {
        company: {
          ...madeUp(),
          ...REAL_COMPANY,
          name: 'Nexus Freight Private Limited',
          address: '9-1-128, Ganesh Nagar, Revenue Ward 64, Gajuwaka, Visakhapatnam, Andhra Pradesh - 530026',
        },
      },
    };
    correctSavedCompany(db);
    expect(db.config.company.name).toBe(REAL_COMPANY.name);
    expect(db.config.company.address).toBe(REAL_COMPANY.address);
  });

  it('a company somebody edited is left as they typed it', () => {
    const edited = { ...madeUp(), ...REAL_COMPANY, name: 'Nexus Freight Pvt Ltd', address: 'Door 4, Auto Nagar\nVisakhapatnam' };
    const db = { config: { company: { ...edited } } };
    correctSavedCompany(db);
    expect(db.config.company).toEqual(edited);

    const other = { ...madeUp(), gstin: '37ABCDE1234F1Z5' };
    const db2 = { config: { company: { ...other } } };
    correctSavedCompany(db2);
    expect(db2.config.company).toEqual(other);
  });
});

describe('the address and added details, as printed', () => {
  it('the address keeps its lines, and sits on one line in the footer', () => {
    expect(addressLines(REAL_COMPANY.address)).toEqual([
      '9-1-128, Ganesh Nagar, Revenue Ward 64, Gajuwaka',
      'Visakhapatnam, Andhra Pradesh',
      '530026',
    ]);
    expect(addressOneLine(REAL_COMPANY.address)).toBe('9-1-128, Ganesh Nagar, Revenue Ward 64, Gajuwaka, Visakhapatnam, Andhra Pradesh, 530026');
    expect(addressLines('Plot 44, MIDC Ambad')).toEqual(['Plot 44, MIDC Ambad']);
  });

  it('a detail added in the control panel is on the next invoice read, and an empty one is not printed', async () => {
    const config = await call('ADMIN', 'GET', '/config');
    await call('ADMIN', 'PATCH', '/config', {
      company: { ...config.company, extra: [{ label: 'MSME Number', value: 'UDYAM-AP-10-0012345' }, { label: 'TAN', value: ' ' }] },
    });
    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    expect(invoice.company.extra).toHaveLength(2);
    expect(companyExtraLines(invoice.company)).toEqual(['MSME Number: UDYAM-AP-10-0012345']);
    expect(companyExtraLines({})).toEqual([]);
  });
});

describe('the downloaded invoice', () => {
  it('is one page, with the real company, a three-line address and added details', async () => {
    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    const doc = await buildInvoicePdf({
      ...invoice,
      company: {
        ...invoice.company,
        ...REAL_COMPANY,
        extra: [
          { label: 'MSME Number', value: 'UDYAM-AP-10-0012345' },
          { label: 'TAN', value: 'VPNN01234A' },
        ],
      },
    });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('closes up its spacing rather than run to a second page', async () => {
    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    // Ten extra lines of note: over a page at the normal spacing, within one once closed up.
    const notes = Array.from({ length: 10 }, (_, i) => `Note line ${i + 1}`).join('\n');
    const doc = await buildInvoicePdf({ ...invoice, company: { ...invoice.company, ...REAL_COMPANY }, notes });
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

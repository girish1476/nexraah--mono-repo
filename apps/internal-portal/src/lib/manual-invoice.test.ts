import { describe, expect, it } from 'vitest';
import type { Client } from '@/app/clients/types';
import { BULK_COLUMNS, bulkRowToInput, bulkRowsFromCsv, checkManualInvoice, isoDayOf, parseCsv } from './manual-invoice';

const client = {
  id: 'c1',
  code: 'CLT-0092',
  name: 'Berger Paints',
  billingCity: 'Kolkata',
  billingAddress: '32 Chowringhee Road',
  billingState: 'West Bengal',
  billingPincode: '700071',
  gstin: '19AAACB2545C1Z9',
  creditDays: 30,
} as unknown as Client;

describe('bulk manual invoices from a sheet', () => {
  it('reads CSV the way Excel writes it — quotes, commas inside quotes, CRLF, a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('matches headers loosely and reports the ones it does not know', () => {
    const { rows, unknownHeaders } = bulkRowsFromCsv('Client,Vehicle No,FROM,To,Gross Weight,Freight,Colour\nclt-0092,KA01AB4321,Bengaluru,Chennai,"21,000",40000,red\n');
    expect(rows).toEqual([{ client: 'clt-0092', vehicleNo: 'KA01AB4321', fromPlace: 'Bengaluru', toPlace: 'Chennai', grossWeightKg: '21,000', rate: '40000' }]);
    expect(unknownHeaders).toEqual(['Colour']);
  });

  it('takes a date as 2026-11-07, 07-11-2026 or 7/11/2026', () => {
    expect(['2026-11-07', '07-11-2026', '7/11/2026', '7.11.2026'].map(isoDayOf)).toEqual(Array(4).fill('2026-11-07'));
  });

  it('fills what a row leaves out from the client, and is then a complete GST invoice', () => {
    const input = bulkRowToInput(
      { client: 'Berger Paints', invoiceDate: '07/11/2026', consignee: 'Asian Depot', vehicleNo: 'WB 23 C 1199', fromPlace: 'Kolkata', toPlace: 'Nashik', goods: 'Paint drums', grossWeightKg: '18000', rate: '₹1,86,000', loading: '2500' },
      [client],
    );
    expect(input).toMatchObject({
      clientId: 'c1',
      invoiceDate: '2026-11-07',
      dueDate: '2026-12-07',
      placeOfSupply: 'West Bengal',
      billTo: { name: 'Berger Paints', gstin: '19AAACB2545C1Z9', address: '32 Chowringhee Road, Kolkata, West Bengal, 700071' },
      consignor: { name: 'Berger Paints', gstin: '19AAACB2545C1Z9' },
      items: [{ description: 'Freight for transportation of Paint drums from Kolkata to Nashik', qty: 1, unit: 'Trip', ratePaise: 18_600_000 }],
      extraCharges: [{ label: 'Loading charges', amountPaise: 250_000 }],
    });
    expect(checkManualInvoice(input)).toEqual([]);
  });

  it('says what a half-filled row still needs', () => {
    expect(checkManualInvoice(bulkRowToInput({ client: 'Berger Paints', invoiceDate: '2026-11-07' }, [client]))).toEqual([
      'Consignee is missing',
      'Vehicle number is missing',
      'From (place of origin) is missing',
      'To (destination) is missing',
      'Description of goods is missing',
      'Gross weight is missing',
      'Rate is missing',
    ]);
  });

  it('offers a template whose every column it can read back', () => {
    const csv = BULK_COLUMNS.map((c) => `"${c.header}"`).join(',') + '\n' + BULK_COLUMNS.map((c) => c.example).join(',');
    const { unknownHeaders } = bulkRowsFromCsv(csv);
    expect(unknownHeaders).toEqual([]);
  });
});

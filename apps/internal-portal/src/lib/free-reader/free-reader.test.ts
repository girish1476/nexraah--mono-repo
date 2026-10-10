import { describe, expect, it } from 'vitest';
import type { ReadField } from '../attachments';
import { gstinCheckDigit } from '../../../../internal-api/src/modules/ocr/ocr.formats';
import { readText } from './index';

/**
 * The free document reader (10 Oct 2026): picking a form's details out of a
 * document's text, and leaving blank what cannot be told apart. The text here
 * is what a PDF or a clear scan gives; reading the picture itself is the
 * browser's part and is not exercised here.
 */

const TODAY = '2026-10-10';
const read = (text: string, fields: ReadField[]) => readText(text, fields, TODAY);

// Real check digits, so the GSTINs pass the same check a real one does.
const gstin = (first14: string) => first14 + gstinCheckDigit(first14);
const SELLER = gstin('37AAKCN9322K1Z');
const BUYER = gstin('33AABCB1234C1Z');

describe('numbers with a shape of their own', () => {
  it('a GSTIN is found by its shape and kept only when its check digit is right', () => {
    const fields: ReadField[] = [{ key: 'g', label: 'GSTIN', format: 'gstin' }];
    expect(read(`Tax Invoice\nGSTIN: ${SELLER}\nState: Andhra Pradesh`, fields).values.g).toBe(SELLER);
    const wrong = SELLER.slice(0, 14) + (SELLER[14] === 'A' ? 'B' : 'A');
    const blank = read(`GSTIN: ${wrong}`, fields);
    expect(blank.values.g).toBeUndefined();
    expect(blank.unread).toEqual(['g']);
  });

  it('with two GSTINs on the page, the consignor’s is the one beside "Consignor" or "From"', () => {
    const text = `E-WAY BILL\nFrom\nGSTIN : ${SELLER}\nNEXUS FREIGHT\nTo\nGSTIN : ${BUYER}\nBERGER PAINTS`;
    expect(read(text, [{ key: 'g', label: 'Consignor GSTIN', format: 'gstin' }]).values.g).toBe(SELLER);
    expect(read(text, [{ key: 'g', label: 'Consignee GSTIN', format: 'gstin' }]).values.g).toBe(BUYER);
  });

  it('a PAN is read off a PAN card; a ten-digit phone number is never taken for one', () => {
    const fields: ReadField[] = [{ key: 'reference', label: 'PAN number', format: 'pan' }];
    expect(read('INCOME TAX DEPARTMENT\nPermanent Account Number Card\nAAKCN9322K\nNEXUS FREIGHT PRIVATE LIMITED', fields).values.reference).toBe('AAKCN9322K');
    expect(read('Contact 1205851208 for queries', fields).values.reference).toBeUndefined();
  });

  it('a vehicle number is read with or without its spaces', () => {
    const fields: ReadField[] = [{ key: 'v', label: 'Vehicle number on it', format: 'vehicle' }];
    expect(read('Vehicle No: AP 39 EW 3699\nDriver: Ramesh', fields).values.v).toBe('AP39EW3699');
    expect(read('Regn. Number AP39BR9963', fields).values.v).toBe('AP39BR9963');
  });

  it('IFSC, Udyam and e-way bill numbers', () => {
    expect(read('IFSC Code: INDB0000081', [{ key: 'i', label: 'IFSC', format: 'ifsc' }]).values.i).toBe('INDB0000081');
    expect(read('UDYAM REGISTRATION NUMBER UDYAM-AP-10-0012345', [{ key: 'u', label: 'Udyam registration number', format: 'udyam' }]).values.u).toBe('UDYAM-AP-10-0012345');
    expect(read('E-Way Bill No: 3812 4456 7781\nGenerated Date: 10/10/2026', [{ key: 'e', label: 'E-way bill number', format: 'ewayBill' }]).values.e).toBe('381244567781');
  });

  it('a bank account number is the one beside "A/c No", not the cheque or MICR number', () => {
    const text = 'INDUSIND BANK\nA/c No. 256303933846\nIFSC INDB0000081\nMICR 530234002\nCheque No 000123';
    const out = read(text, [
      { key: 'bankAccount', label: 'Account number', format: 'bankAccount' },
      { key: 'ifsc', label: 'IFSC', format: 'ifsc' },
    ]);
    expect(out.values).toEqual({ bankAccount: '256303933846', ifsc: 'INDB0000081' });
  });
});

describe('dates', () => {
  it('the only date on a paper is its date, read day first', () => {
    const out = read('Fitness Certificate\nValid Upto: 04/03/2027', [{ key: 'd', label: 'Valid till', type: 'date' }]);
    expect(out.values.d).toBe('2027-03-04');
  });

  it('one PDF of a truck’s papers: each validity is the one beside its own paper’s name', () => {
    const text = [
      'REGISTRATION CERTIFICATE AP39EW3699',
      'Registration Date: 12-Jan-2021',
      'Fitness Upto: 11-Jan-2027',
      'Insurance Upto: 05-Feb-2027',
      'PUCC Upto: 20-Dec-2026',
      'Permit Valid Upto: 30-Jun-2028',
    ].join('\n');
    const out = read(text, [
      { key: 'fitnessValidTill', label: 'Fitness valid till', type: 'date' },
      { key: 'insuranceValidTill', label: 'Insurance (IC) valid till', type: 'date' },
      { key: 'pucValidTill', label: 'Pollution (PUC) valid till', type: 'date' },
      { key: 'permitValidTill', label: 'Permit valid till', type: 'date' },
    ]);
    expect(out.values).toEqual({
      fitnessValidTill: '2027-01-11',
      insuranceValidTill: '2027-02-05',
      pucValidTill: '2026-12-20',
      permitValidTill: '2028-06-30',
    });
  });

  it('"from … to …": a paper runs out on the later date', () => {
    const out = read('Period of Insurance: From 06/02/2026 To 05/02/2027', [{ key: 'd', label: 'Insurance (IC) valid till', type: 'date' }]);
    expect(out.values.d).toBe('2027-02-05');
  });

  it('a date that has passed is given, with a warning', () => {
    const out = read('PUCC Valid Upto: 01/09/2026', [{ key: 'd', label: 'Pollution (PUC) valid till', type: 'date' }]);
    expect(out.values.d).toBe('2026-09-01');
    expect(out.notes.d).toMatch(/already passed/);
  });

  it('several dates and nothing to say which is meant: left blank', () => {
    const out = read('12/01/2021\n05/02/2027\n30/06/2028', [{ key: 'd', label: 'Insurance (IC) valid till', type: 'date' }]);
    expect(out.values.d).toBeUndefined();
    expect(out.unread).toEqual(['d']);
  });
});

describe('an invoice, a loading slip and a lorry receipt', () => {
  it('invoice number and invoice value', () => {
    const text = `TAX INVOICE\nInvoice No: SC/26-27/0412   Date: 08/10/2026\nGSTIN: ${SELLER}\nTaxable Value 1,10,000.00\nIGST 18% 19,800.00\nGrand Total ₹ 1,29,800.00`;
    const out = read(text, [
      { key: 'invoiceNo', label: 'Invoice number' },
      { key: 'invoiceValue', label: 'Invoice value (₹)', type: 'rupees' },
    ]);
    expect(out.values).toEqual({ invoiceNo: 'SC/26-27/0412', invoiceValue: '129800.00' });
  });

  it('weights are given in tonnes, converted from kilograms where the slip prints those', () => {
    const fields: ReadField[] = [
      { key: 'slipNo', label: 'Slip number' },
      { key: 'netWeightTn', label: 'Net weight (MT)', type: 'number' },
    ];
    expect(read('WEIGHMENT SLIP\nTicket No: 4471\nGross Weight 46,250 Kg\nTare Weight 15,250 Kg\nNet Weight 31,000 Kg', fields).values).toEqual({ slipNo: '4471', netWeightTn: '31' });
    expect(read('Slip No 88\nNet Wt. 31.250 MT', fields).values).toEqual({ slipNo: '88', netWeightTn: '31.250' });
  });

  it('LR number, packages and the consignee’s name', () => {
    const text = 'LORRY RECEIPT\nG.R. No: LR-00002\nConsignor: SIRIMAN CHEMICALS\nConsignee: BALAJI AGRO TRADERS\nNo. of Packages 640\nActual Weight 32 MT';
    const out = read(text, [
      { key: 'lrNo', label: 'LR number' },
      { key: 'packages', label: 'Packages loaded', type: 'number' },
      { key: 'loadedWeightTn', label: 'Weight loaded (MT)', type: 'number' },
      { key: 'consigneeName', label: 'Consignee name' },
    ]);
    expect(out.values).toEqual({ lrNo: 'LR-00002', packages: '640', loadedWeightTn: '32', consigneeName: 'BALAJI AGRO TRADERS' });
  });

  it('a driving licence: its number, the holder’s name, and when it runs out', () => {
    const text = 'INDIAN UNION DRIVING LICENCE\nDL No: AP03 20190012345\nName: RAMESH KUMAR\nDate of Issue: 14/08/2019\nValid Till: 13/08/2039';
    const out = read(text, [
      { key: 'dlNo', label: 'Licence number', format: 'drivingLicence' },
      { key: 'driverName', label: 'Driver name', format: 'name' },
      { key: 'validTill', label: 'Valid till', type: 'date' },
    ]);
    expect(out.values.dlNo).toBe('AP0320190012345');
    expect(out.values.driverName).toMatch(/^Ramesh Kumar$/i);
    expect(out.values.validTill).toBe('2039-08-13');
  });
});

describe('what is not on the page is left blank', () => {
  it('nothing is invented from an unrelated page', () => {
    const out = read('Thank you for your business.\nPlease visit again.', [
      { key: 'g', label: 'Consignor GSTIN', format: 'gstin' },
      { key: 'invoiceNo', label: 'Invoice number' },
      { key: 'invoiceValue', label: 'Invoice value (₹)', type: 'rupees' },
      { key: 'd', label: 'Valid till', type: 'date' },
      { key: 'n', label: 'Consignee name' },
    ]);
    expect(out.values).toEqual({});
    expect(out.unread).toEqual(['g', 'invoiceNo', 'invoiceValue', 'd', 'n']);
  });

  it('a word after "Invoice No" that is not a number is not taken for one', () => {
    expect(read('Invoice No: pending', [{ key: 'invoiceNo', label: 'Invoice number' }]).values).toEqual({});
  });
});

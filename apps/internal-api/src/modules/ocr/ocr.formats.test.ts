import { describe, it, expect } from 'vitest';
import { checkFormat, gstinCheckDigit, isRealDate, printedDates, settleDate, settleNumber, verhoeffValid } from './ocr.formats';
import { settleReading } from './ocr.reading';
import { ask } from './ocr.service';
import type { OcrFieldDto, ReadDocumentDto } from './ocr.dto';

/** The one digit that makes eleven digits into a number passing Aadhaar's check. Made up here — nobody's real number. */
function withCheckDigit(first11: string): string {
  const fits = [...'0123456789'].filter((d) => verhoeffValid(first11 + d));
  expect(fits).toHaveLength(1);
  return first11 + fits[0];
}
const AADHAAR = withCheckDigit('49911882744');

describe('Aadhaar — only ever the last four, and only from a number that passes its own check', () => {
  it('knows the Verhoeff check', () => {
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('2364')).toBe(false);
  });

  it('gives the last four digits of a clean read, however the card spaces it', () => {
    const spaced = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;
    expect(checkFormat('aadhaarLast4', spaced)).toEqual({ value: AADHAAR.slice(-4) });
  });

  it('never gives back more than four digits', () => {
    expect(checkFormat('aadhaarLast4', AADHAAR).value).toHaveLength(4);
  });

  it('leaves it blank when one digit is misread — anywhere in the number', () => {
    for (let i = 0; i < 12; i++) {
      const wrong = AADHAAR.slice(0, i) + ((Number(AADHAAR[i]) + 1) % 10) + AADHAAR.slice(i + 1);
      expect(checkFormat('aadhaarLast4', wrong).value).toBeNull();
    }
  });

  it('leaves it blank when two neighbouring digits are swapped', () => {
    const i = [...AADHAAR].findIndex((d, n) => n > 0 && n < 11 && d !== AADHAAR[n + 1]);
    const swapped = AADHAAR.slice(0, i) + AADHAAR[i + 1] + AADHAAR[i] + AADHAAR.slice(i + 2);
    expect(checkFormat('aadhaarLast4', swapped).value).toBeNull();
  });

  it('reads a masked card', () => {
    expect(checkFormat('aadhaarLast4', 'XXXX XXXX 4471')).toEqual({ value: '4471' });
    expect(checkFormat('aadhaarLast4', '**** **** 4471')).toEqual({ value: '4471' });
  });

  it('does not take the sixteen-digit Virtual ID for the number', () => {
    expect(checkFormat('aadhaarLast4', '9123 4567 8901 2345').value).toBeNull();
  });
});

describe('PAN', () => {
  it('takes a well-formed PAN, spaced or not', () => {
    expect(checkFormat('pan', 'aakcr2148l')).toEqual({ value: 'AAKCR2148L' });
    expect(checkFormat('pan', 'AAKCR 2148 L')).toEqual({ value: 'AAKCR2148L' });
  });

  it('settles a look-alike where the pattern leaves no doubt, and says so', () => {
    // A zero where only a letter can be, a letter O where only a digit can be.
    const settled = checkFormat('pan', 'AAKC02I48L');
    expect(settled.value).toBe('AAKCO2148L');
    expect(settled.note).toBeTruthy();
  });

  it('leaves the wrong length or the wrong shape blank', () => {
    expect(checkFormat('pan', 'AAKCR2148').value).toBeNull();
    expect(checkFormat('pan', 'AAKCR2148LX').value).toBeNull();
    expect(checkFormat('pan', '12345ABCDE').value).toBeNull();
  });

  it('flags a fourth letter no PAN uses', () => {
    expect(checkFormat('pan', 'AAKXR2148L').note).toBeTruthy();
  });
});

describe('GSTIN', () => {
  const GSTIN = '27AAPFU0939F1ZV';

  it('agrees with the published check digit', () => {
    expect(gstinCheckDigit(GSTIN.slice(0, 14))).toBe('V');
    expect(checkFormat('gstin', GSTIN)).toEqual({ value: GSTIN });
  });

  it('leaves a GSTIN blank when a character is misread', () => {
    expect(checkFormat('gstin', '27AAPFU0939F1ZW').value).toBeNull();
    expect(checkFormat('gstin', '27AAPFU0938F1ZV').value).toBeNull();
    expect(checkFormat('gstin', '27AAPFU0939F1Z').value).toBeNull();
  });
});

describe('vehicle and licence numbers', () => {
  it('takes the registration formats in use', () => {
    expect(checkFormat('vehicle', 'MH 15 GT 4482')).toEqual({ value: 'MH15GT4482' });
    expect(checkFormat('vehicle', 'dl-1lab-1234')).toEqual({ value: 'DL1LAB1234' });
    expect(checkFormat('vehicle', '22 BH 1234 AA')).toEqual({ value: '22BH1234AA' });
  });

  it('does not take a chassis number for a registration number', () => {
    expect(checkFormat('vehicle', 'MAT445055K7B12345').value).toBeNull();
  });

  it('takes a standard licence number, and an older one with a note', () => {
    expect(checkFormat('drivingLicence', 'MH14 20110012345')).toEqual({ value: 'MH1420110012345' });
    expect(checkFormat('drivingLicence', 'MH-14/2011/0012345')).toEqual({ value: 'MH1420110012345' });
    const old = checkFormat('drivingLicence', 'TN07Z20080001234');
    expect(old.value).toBe('TN07Z20080001234');
    expect(old.note).toBeTruthy();
    expect(checkFormat('drivingLicence', 'RAMESH KUMAR').value).toBeNull();
  });
});

describe('bank, e-way bill and the rest', () => {
  it('reads an IFSC, and the zero that is so often read as a letter', () => {
    expect(checkFormat('ifsc', 'HDFC0001234')).toEqual({ value: 'HDFC0001234' });
    expect(checkFormat('ifsc', 'HDFCO001234').value).toBe('HDFC0001234');
    expect(checkFormat('ifsc', 'HDFC1001234').value).toBeNull();
  });

  it('holds an account number to digits', () => {
    expect(checkFormat('bankAccount', '5010 0123 456789')).toEqual({ value: '50100123456789' });
    expect(checkFormat('bankAccount', '000123').value).toBeNull();
  });

  it('holds an e-way bill number to twelve digits', () => {
    expect(checkFormat('ewayBill', '3310 0456 7812')).toEqual({ value: '331004567812' });
    expect(checkFormat('ewayBill', '33100456781').value).toBeNull();
  });

  it('writes an Udyam number one way', () => {
    expect(checkFormat('udyam', 'udyam mh 18 0012345')).toEqual({ value: 'UDYAM-MH-18-0012345' });
  });

  it('reads a phone number with its country code and a PIN code', () => {
    expect(checkFormat('phone', '+91 98765 43210')).toEqual({ value: '9876543210' });
    expect(checkFormat('pincode', '422 001')).toEqual({ value: '422001' });
  });

  it('does not take a number for a name', () => {
    expect(checkFormat('name', '  Ramesh   Kumar ')).toEqual({ value: 'Ramesh Kumar' });
    expect(checkFormat('name', 'MH1420110012345').value).toBeNull();
  });
});

describe('dates — day first, always', () => {
  it('knows a real date from an impossible one', () => {
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2027-02-29')).toBe(false);
    expect(isRealDate('2027-13-01')).toBe(false);
    expect(isRealDate('27-03-2027')).toBe(false);
  });

  it('reads every way a date is printed', () => {
    for (const printed of ['04/03/2027', '04-03-2027', '04.03.2027', '04-Mar-2027', '4 March 2027', '04 MAR, 2027', '2027-03-04']) {
      expect(printedDates(printed)).toEqual(['2027-03-04']);
    }
    expect(printedDates('04/03/2027 23:59')).toEqual(['2027-03-04']);
  });

  it('does not guess the century of a two-digit year', () => {
    expect(printedDates('04/03/27')).toEqual([]);
  });

  it('puts right a day and month turned round', () => {
    const settled = settleDate('2027-04-03', '04/03/2027');
    expect(settled.value).toBe('2027-03-04');
    expect(settled.note).toBeTruthy();
  });

  it('leaves a date alone when the two agree, or when the printed text holds two dates', () => {
    expect(settleDate('2027-03-04', '04/03/2027')).toEqual({ value: '2027-03-04' });
    expect(settleDate('2027-03-31', '01/04/2026 to 31/03/2027')).toEqual({ value: '2027-03-31' });
  });

  it('drops what is not a date', () => {
    expect(settleDate('2027-02-30', null).value).toBeNull();
    expect(settleDate('31 March', null).value).toBeNull();
  });
});

describe('amounts', () => {
  it('reads Indian digit grouping and the marks around an amount', () => {
    expect(settleNumber('₹ 1,25,000.50').value).toBe('125000.50');
    expect(settleNumber('Rs. 125000/-').value).toBe('125000');
    expect(settleNumber('12.480 MT').value).toBe('12.480');
    expect(settleNumber('twelve').value).toBeNull();
  });
});

describe('a whole reading', () => {
  const fields: OcrFieldDto[] = [
    { key: 'dlNo', label: 'Licence number', format: 'drivingLicence' },
    { key: 'validTill', label: 'Valid till', type: 'date' },
    { key: 'driverName', label: 'Driver name', format: 'name' },
    { key: 'invoiceValue', label: 'Invoice value (₹)', type: 'rupees' },
  ];

  it('fills what passed, lists what did not, and notes what the checker should look at', () => {
    const reading = settleReading(
      fields,
      {
        dlNo: { value: 'MH1420110012345', printed: 'MH14 20110012345' },
        validTill: { value: '2025-11-08', printed: '08-11-2025' },
        driverName: { value: null, printed: null },
        invoiceValue: { value: '1,25,000', printed: '₹1,25,000' },
      },
      '2026-10-08',
    );
    expect(reading.values).toEqual({ dlNo: 'MH1420110012345', validTill: '2025-11-08', invoiceValue: '125000' });
    expect(reading.unread).toEqual(['driverName']);
    expect(reading.notes.validTill).toMatch(/already passed/);
  });

  it('survives a detail the reader left out altogether', () => {
    expect(settleReading(fields, {}, '2026-10-08').unread).toHaveLength(fields.length);
  });

  it('never lets a full Aadhaar number through, whatever the reader sends', () => {
    const reading = settleReading(
      [{ key: 'value', label: 'Aadhaar number', format: 'aadhaarLast4' }],
      { value: { value: AADHAAR, printed: AADHAAR } },
      '2026-10-08',
    );
    expect(JSON.stringify(reading)).not.toContain(AADHAAR);
    expect(reading.values.value).toBe(AADHAAR.slice(-4));
  });
});

describe('what the reader is asked', () => {
  const dto = (docType?: ReadDocumentDto['docType']): ReadDocumentDto => ({
    document: 'Driving licence',
    docType,
    fields: [
      { key: 'dlNo', label: 'Licence number', format: 'drivingLicence' },
      { key: 'validTill', label: 'Valid till', type: 'date' },
    ],
  });

  it('names each detail, its kind and its label', () => {
    const text = ask(dto(), undefined);
    expect(text).toContain('- dlNo (text — a driving licence number');
    expect(text).toContain('- validTill (date): Valid till');
    expect(text).not.toContain('About this kind of document');
  });

  it('says where to look when it knows what the paper is', () => {
    expect(ask(dto('DRIVING_LICENCE'), 'DRIVING_LICENCE')).toContain('transport (TR)');
  });
});

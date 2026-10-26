import { describe, expect, it } from 'vitest';
import { checkAgainstStatement, csvRows, dayOf, journalLines, readStatement, StatementUnreadable, type PaymentToCheck } from './accounting';

describe('dates as banks write them', () => {
  it('all come out as YYYY-MM-DD', () => {
    expect(dayOf('2026-10-05')).toBe('2026-10-05');
    expect(dayOf('2026-10-05T10:00:00+05:30')).toBe('2026-10-05');
    expect(dayOf('05/10/2026')).toBe('2026-10-05');
    expect(dayOf('5-10-26')).toBe('2026-10-05');
    expect(dayOf('05 Oct 2026')).toBe('2026-10-05');
    expect(dayOf('05-Oct-26')).toBe('2026-10-05');
    expect(dayOf('')).toBeNull();
    expect(dayOf('Opening balance')).toBeNull();
  });
});

describe('the accounting journal', () => {
  const lines = journalLines(
    {
      invoices: [
        { code: 'INV-1', clientName: 'Berger Paints', invoiceDate: '2026-10-03', totalPaise: 2240000, status: 'ISSUED' },
        { code: 'INV-2', clientName: 'Apex', invoiceDate: '2026-10-04', totalPaise: 100000, status: 'CANCELLED' },
        { code: 'INV-0', clientName: 'Apex', invoiceDate: '2026-09-30', totalPaise: 100000, status: 'PAID' },
      ],
      receipts: [{ code: 'RCT-1', invoiceCode: 'INV-1', clientName: 'Berger Paints', receivedOn: '2026-10-08', amountPaise: 1000000, mode: 'NEFT', reference: 'HDFC1' }],
      payments: [{ kind: 'BALANCE', tripCode: 'TRP-9', vendorName: 'Sai Kripa', netPaise: 1500000, utr: 'UTR123456', valueDate: '2026-10-09' }],
    },
    '2026-10-01',
    '2026-10-31',
  );

  it('posts each voucher as one debit and one equal credit, leaving out cancelled bills and other months', () => {
    expect(lines.map((l) => [l.voucherNo, l.ledger, l.debitPaise, l.creditPaise])).toEqual([
      ['INV-1', 'Berger Paints', 2240000, 0],
      ['INV-1', 'Freight income', 0, 2240000],
      ['RCT-1', 'Bank', 1000000, 0],
      ['RCT-1', 'Berger Paints', 0, 1000000],
      ['BALANCE-TRP-9', 'Sai Kripa', 1500000, 0],
      ['BALANCE-TRP-9', 'Bank', 0, 1500000],
    ]);
    const sum = (k: 'debitPaise' | 'creditPaise') => lines.reduce((a, l) => a + l[k], 0);
    expect(sum('debitPaise')).toBe(sum('creditPaise'));
    expect(lines[4].narration).toBe('Balance for trip TRP-9 · UTR UTR123456');
  });
});

describe('a bank statement', () => {
  // As an Indian bank's download looks: a title block, then the heading row.
  const hdfc = [
    'HDFC BANK Ltd.,,,,,,',
    'Account No : 50100123456789,,,,,,',
    ',,,,,,',
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '08/10/26,NEFT CR-BERGER PAINTS,HDFC1,08/10/26,,"10,000.00","5,10,000.00"',
    '09/10/26,"NEFT DR-SAI KRIPA CARRIERS-N123456789",N123456789,09/10/26,"15,000.00",,"4,95,000.00"',
    '10/10/26,RENT OCT,000045,10/10/26,"40,000.00",,"4,55,000.00"',
    '11/10/26,IMPS-777888999-BHAGWATI,777888999,11/10/26,"9,500.00",,"4,45,500.00"',
  ].join('\n');

  it('is read from its heading row, keeping only the money out', () => {
    const lines = readStatement(hdfc);
    expect(lines.map((l) => [l.date, l.debitPaise])).toEqual([
      ['2026-10-09', 1500000],
      ['2026-10-10', 4000000],
      ['2026-10-11', 950000],
    ]);
    expect(lines[0].text).toContain('N123456789');
  });

  it('is read with an Amount column and a Dr/Cr column', () => {
    const sbi = 'Txn Date,Description,Ref No,Amount,Dr / Cr\n09 Oct 2026,TO TRANSFER UTR N123456789,N123456789,"15,000.00",DR\n10 Oct 2026,BY CLEARING,1,500.00,CR';
    expect(readStatement(sbi).map((l) => l.debitPaise)).toEqual([1500000]);
  });

  it('that cannot be read says what it needs', () => {
    expect(() => readStatement('a,b\n1,2')).toThrow(StatementUnreadable);
  });

  it('keeps quoted commas and quotes inside one cell', () => {
    expect(csvRows('"a, b","say ""hi""",c\r\n1,2,3')).toEqual([
      ['a, b', 'say "hi"', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('finds each UTR — and the one keyed wrong, and the one paid a different amount', () => {
    const pay = (id: string, utr: string, netPaise: number, valueDate = '2026-10-10'): PaymentToCheck => ({
      id,
      kind: 'BALANCE',
      tripCode: `TRP-${id}`,
      vendorName: 'X',
      utr,
      netPaise,
      valueDate,
    });
    const result = checkAgainstStatement(
      [
        pay('1', 'n123456789', 1500000),
        pay('2', '777888999', 900000),
        pay('3', '777888990', 500000),
        pay('4', 'ABC000111', 500000, '2026-09-01'),
      ],
      readStatement(hdfc),
    );
    expect(result.matched.map((m) => m.payment.id)).toEqual(['1']);
    expect(result.amountDiffers.map((m) => m.payment.id)).toEqual(['2']);
    expect(result.notFound.map((p) => p.id)).toEqual(['3']);
    expect(result.outside.map((p) => p.id)).toEqual(['4']);
    expect(result.notInConsole.map((l) => l.text)).toEqual(['RENT OCT · 000045']);
    expect(result.period).toEqual({ from: '2026-10-09', to: '2026-10-11' });
  });
});

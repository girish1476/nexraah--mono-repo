import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { REAL_COMPANY } from './clean-data';
import { invoiceLines, invoiceTotals, lrNumbers } from '../lib/invoice-layout';
import { buildInvoicePdf } from '../lib/invoice-pdf';
import type { RoleCode } from '../lib/permissions';

/**
 * One invoice for several vehicles (10 Oct 2026).
 *
 * Each vehicle is its own row on the invoice, with its lorry receipt number;
 * the rows add up to the invoice; a load of another client, or one already
 * billed, is refused; and a dozen vehicles still print properly.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const failure = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  try {
    await call(role, method, url, data);
  } catch (e) {
    return String((e as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code ?? (e as Error).message);
  }
  return null;
};

// Berger Paints (c-0092) has two unbilled loads; Apex Ceramics (c-0090) has two of its own.
const BERGER = ['t-120881', 't-120874'];
const APEX = 't-120855';
const draft = (tripIds: string[], freightPaise: number) => ({
  clientId: 'c-0092',
  invoiceDate: '2026-10-10',
  dueDate: '2026-11-24',
  tripIds,
  freightPaise,
});

describe('one invoice for several vehicles', () => {
  it('a load of another client is refused, and so is one that does not exist', async () => {
    expect(await failure('FINANCE', 'POST', '/invoices', draft([...BERGER, APEX], 1))).toBe('TRIP_OTHER_CLIENT');
    expect(await failure('FINANCE', 'POST', '/invoices', draft([...BERGER, 't-nope'], 1))).toBe('NOT_FOUND');
  });

  it('each vehicle is its own row with its LR number, and the rows add up to the invoice', async () => {
    const ready = (await call('FINANCE', 'GET', '/trips?invoiceable=1')).filter((t: any) => BERGER.includes(t.id));
    expect(ready).toHaveLength(2);
    const freight = ready.reduce((a: number, t: any) => a + t.sellRatePaise, 0);

    const created = await call('FINANCE', 'POST', '/invoices', draft(BERGER, freight));
    const issued = await call('FINANCE', 'POST', `/invoices/${created.id}/generate`);
    expect(issued.code).toMatch(/^NEX-INV-/);

    const invoice = await call('FINANCE', 'GET', `/invoices/${created.id}`);
    const lines = invoiceLines(invoice);
    expect(lines).toHaveLength(2);
    for (const t of ready) {
      const line = lines.find((l) => l.title.includes(t.vehicleNo))!;
      expect(line.title).toBe(`Transportation charges (${t.vehicleNo})`);
      expect(line.amountPaise).toBe(t.sellRatePaise);
      expect(line.sub[0]).toContain(`LR ${t.lrCode}`);
    }
    expect(invoiceTotals(invoice).subTotalPaise).toBe(freight);
    expect(invoice.totalPaise).toBe(freight);
    expect(lrNumbers(invoice)).toBe(ready.map((t: any) => t.lrCode).join(', '));

    // Both loads are billed now: neither is offered again, nor accepted on a second invoice.
    const after = await call('FINANCE', 'GET', '/trips?invoiceable=1');
    expect(after.some((t: any) => BERGER.includes(t.id))).toBe(false);
    expect(await failure('FINANCE', 'POST', '/invoices', draft([BERGER[0]], 1))).toBe('TRIP_ALREADY_BILLED');
  });

  it('a single vehicle still reads as it always has: a line each for route, rate and weight', async () => {
    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    const [line] = invoiceLines(invoice);
    expect(line.sub[0]).toBe('Pune to Surat');
    expect(line.sub.join(' ')).not.toContain('LR ');
  });
});

describe('the downloaded invoice for many vehicles', () => {
  const many = async (count: number) => {
    const invoice = await call('FINANCE', 'GET', '/invoices/inv-411');
    const base = invoice.trips[0];
    const trips = Array.from({ length: count }, (_, i) => ({
      ...base,
      id: `t-many-${i}`,
      vehicleNo: `AP39EW${3600 + i}`,
      lrCode: `LR-${String(i + 1).padStart(5, '0')}`,
      lane: 'Atchuthapuram → Thanjavuru',
      ratePerTonnePaise: 3100,
      loadedWeightTn: 31,
      sellRatePaise: 96_100,
    }));
    return {
      ...invoice,
      company: { ...invoice.company, ...REAL_COMPANY },
      trips,
      tripIds: trips.map((t) => t.id),
      freightPaise: 96_100 * count,
      totalPaise: 96_100 * count,
      receivedPaise: 0,
    };
  };

  it('each vehicle is one compact row: route, LR number, weight and rate', async () => {
    const [first] = invoiceLines(await many(3));
    expect(first.title).toBe('Transportation charges (AP39EW3600)');
    expect(first.sub).toEqual(['Atchuthapuram to Thanjavuru · LR LR-00001 · 31 MT · 31 per ton']);
  });

  it('six vehicles fit on one page', async () => {
    const doc = await buildInvoicePdf(await many(6));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('twenty vehicles run on to a second page rather than being cut off', async () => {
    const invoice = await many(20);
    expect(invoiceLines(invoice)).toHaveLength(20);
    const doc = await buildInvoicePdf(invoice);
    expect(doc.getNumberOfPages()).toBe(2);
  });
});

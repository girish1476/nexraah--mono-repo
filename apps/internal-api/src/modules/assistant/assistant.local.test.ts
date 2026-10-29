import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { answerWithoutModel, describe as describeData, ruleFor, type Lookups } from './assistant.local';

const user = { name: 'S. Krishnan', role: 'ADMIN' } as unknown as AuthenticatedUser;
const lookups = (data: unknown, fail?: string): Lookups & { run: ReturnType<typeof vi.fn> } => ({
  run: vi.fn(async () => {
    if (fail) throw new Error(fail);
    return { data, sources: [{ label: 'Orders', href: '/orders' }] };
  }),
});

describe('reading what a question asks for', () => {
  it('finds a truck number however it is written', () => {
    expect(ruleFor('where is mh 12 qr 8841?')).toMatchObject({ lookup: 'search_orders', input: { truck: 'MH12QR8841' } });
    expect(ruleFor('Where is truck MH12QR8841')).toMatchObject({ input: { truck: 'MH12QR8841' } });
  });

  it('finds a bill number and an order number, but not a year', () => {
    expect(ruleFor('status of NEX-INV-000411')).toMatchObject({ lookup: 'search_client_bills', input: { query: 'NEX-INV-000411' } });
    expect(ruleFor('order 4440')).toMatchObject({ lookup: 'search_orders', input: { query: '4440' } });
    expect(ruleFor('profit in 2026')).toMatchObject({ lookup: 'get_profit_and_loss' });
  });

  it('finds the subject', () => {
    expect(ruleFor('how many trucks are on the road')?.lookup).toBe('list_trucks_on_the_road');
    expect(ruleFor('which clients owe us money')?.lookup).toBe('list_receivables');
    expect(ruleFor('any approvals waiting?')?.lookup).toBe('list_approvals');
    expect(ruleFor('client Berger Paints')).toMatchObject({ lookup: 'search_clients', input: { query: 'Berger Paints' } });
    expect(ruleFor('what is the weather')).toBeNull();
  });

  it('reads "no transporter yet" as load requests still open, not as a transporter search', () => {
    expect(ruleFor('which loads have no transporter yet')).toMatchObject({ lookup: 'search_load_requests', input: { stage: 'OPEN' } });
    expect(ruleFor('transporter Sharma')).toMatchObject({ lookup: 'search_transporters', input: { query: 'Sharma' } });
  });
});

describe('answering', () => {
  it('greets by a real name, not an initial, and says what it can do', async () => {
    const answer = await answerWithoutModel('hi', user, lookups(null));
    expect(answer.answer).toMatch(/^Hello Krishnan\./);
    expect(answer.answer).toContain('truck number');
  });

  it('reads the records the lookup returns, with money in rupees and links to the screens', async () => {
    const data = {
      total: 7,
      shown: 2,
      rows: [
        { indentCode: '4440', clientName: 'Berger Paints', lane: 'Pune → Surat', vehicleNo: 'MH 12 QR 8841', status: 'TRACKING' },
        { indentCode: '4436', clientName: 'Apex Ceramics', lane: 'Hosur → Gurugram', totalRupees: 47900 },
      ],
    };
    const l = lookups(data);
    const answer = await answerWithoutModel('trucks on the road', user, l);
    expect(l.run).toHaveBeenCalledWith('list_trucks_on_the_road', {}, user);
    expect(answer.answer).toContain('7 found');
    expect(answer.answer).toContain('• 4440 · Berger Paints · Pune → Surat · MH 12 QR 8841 · TRACKING');
    expect(answer.answer).toContain('total ₹47,900');
    expect(answer.answer).toContain('…and 5 more');
    expect(answer.sources).toEqual([{ label: 'Orders', href: '/orders' }]);
  });

  it('says plainly when the person may not see those records', async () => {
    const answer = await answerWithoutModel('show approvals', user, lookups(null, 'This person does not have access to that.'));
    expect(answer.answer).toMatch(/your role does not open/);
  });

  it('says what it can answer when it cannot tell what was asked', async () => {
    expect((await answerWithoutModel('what is the weather', user, lookups(null))).answer).toMatch(/could not tell/);
  });

  it('writes a single record as its facts', () => {
    expect(describeData({ outstandingRupees: 1450000, dueDate: '2026-11-05', count: 3 })).toBe(
      '• outstanding: ₹14,50,000\n• due date: 05 Nov 2026\n• count: 3',
    );
  });
});

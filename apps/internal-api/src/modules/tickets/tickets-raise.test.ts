import { describe, expect, it, vi } from 'vitest';
import { TicketsService } from './tickets.service';

/** Raising a report: measured as it will be stored, trimmed. */
describe('raising a problem report', () => {
  const service = () => {
    const insert = vi.fn(async (_trx: unknown, row: Record<string, unknown>) => ({ id: 't1', ...row }));
    const repo = { transaction: () => ({ execute: (fn: (trx: unknown) => unknown) => fn({}) }), insert };
    const numbering = { issue: vi.fn(async () => 'TKT-0001') };
    const audit = { record: vi.fn() };
    const svc = new (TicketsService as unknown as new (...a: unknown[]) => TicketsService)(repo, numbering, audit);
    return { svc, insert };
  };
  const actor = { userId: 'u', role: 'OPS' } as never;
  const dto = (detail: string) => ({ subject: 'Rate looks wrong', detail, raisedOnPath: '/clients' }) as never;

  it('takes a report of a few words — the database allows it too since 20261105020000', async () => {
    const { svc, insert } = service();
    await svc.raise(dto('Rate is wrong'), actor).catch(() => undefined);
    expect(insert).toHaveBeenCalled();
    expect(insert.mock.calls[0][1].detail).toBe('Rate is wrong');
  });

  it('answers a report that is only padding in words, before touching the database', async () => {
    const { svc, insert } = service();
    await expect(svc.raise(dto('   ab      '), actor)).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(insert).not.toHaveBeenCalled();
  });
});

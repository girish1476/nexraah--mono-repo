import { describe, expect, it } from 'vitest';
import { syntheticRfqPeriod } from './clients.repository';
import { UNLINKED_ENTITY_ID, attachmentOwnerId } from '../attachments/attachments.service';

/**
 * Two inserts that the in-browser demo accepted and PostgreSQL refused, both
 * found on the first real (preprod) database.
 */
describe("a directly agreed lane's synthetic RFQ", () => {
  it('ends after it starts, as rfqs_period requires', () => {
    const p = syntheticRfqPeriod(new Date('2026-11-03T06:40:00Z'));
    expect(p).toEqual({ period_from: '2026-11-03', period_to: '2027-11-03' });
    expect(p.period_to > p.period_from).toBe(true);
  });

  it('still ends after it starts from a leap day', () => {
    const p = syntheticRfqPeriod(new Date('2028-02-29T12:00:00Z'));
    expect(p.period_to > p.period_from).toBe(true);
  });
});

describe("an upload's owner record", () => {
  it('is a real uuid even before the record exists', () => {
    expect(attachmentOwnerId(undefined)).toBe(UNLINKED_ENTITY_ID);
    expect(attachmentOwnerId('  ')).toBe(UNLINKED_ENTITY_ID);
    expect(UNLINKED_ENTITY_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is the record's own id when there is one", () => {
    expect(attachmentOwnerId('58c531d4-ac12-42cc-a09a-5939a59f3c51')).toBe('58c531d4-ac12-42cc-a09a-5939a59f3c51');
  });

  it('refuses something that is not an id, rather than failing in the database', () => {
    expect(() => attachmentOwnerId('unassigned')).toThrow(/entityId/);
  });
});

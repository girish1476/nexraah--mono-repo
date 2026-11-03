import { describe, expect, it } from 'vitest';
import { databaseErrorAnswer } from './database-errors';

/** The shape node-postgres gives a refused statement. */
const pg = (code: string, constraint?: string) =>
  Object.assign(new Error('db said no'), { code, constraint, severity: 'ERROR' });

describe('a database refusal is answered as the rule it broke', () => {
  it('names a known date rule', () => {
    const a = databaseErrorAnswer(pg('23514', 'invoices_due_after_date'));
    expect(a).toMatchObject({ status: 400, code: 'DATA_RULE', message: 'The due date cannot be before the invoice date.' });
    expect(a?.details).toEqual({ constraint: 'invoices_due_after_date', sqlstate: '23514' });
  });

  it('falls back to a plain sentence for a rule it does not know', () => {
    expect(databaseErrorAnswer(pg('23514', 'some_new_rule'))).toMatchObject({ status: 400, code: 'DATA_RULE' });
  });

  it('says a duplicate is a conflict, not a crash', () => {
    expect(databaseErrorAnswer(pg('23505', 'clients_code_key'))).toMatchObject({ status: 409, code: 'ALREADY_EXISTS' });
  });

  it('says a malformed value is the request’s fault', () => {
    expect(databaseErrorAnswer(pg('22P02'))).toMatchObject({ status: 400, code: 'BAD_FORMAT' });
  });

  it('leaves everything else to the ordinary 500', () => {
    expect(databaseErrorAnswer(pg('57P01'))).toBeNull(); // connection killed by the server
    expect(databaseErrorAnswer(new Error('plain bug'))).toBeNull();
    expect(databaseErrorAnswer({ code: 'ENOTFOUND' })).toBeNull(); // a network error, not PostgreSQL
    expect(databaseErrorAnswer(null)).toBeNull();
  });
});

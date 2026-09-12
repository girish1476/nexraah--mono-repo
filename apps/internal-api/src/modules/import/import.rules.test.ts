import { describe, it, expect } from 'vitest';
import { readTable, parseCsv } from './csv';
import { missingDependencies, validate, isImportSet, IMPORT_SETS } from './import.rules';

const table = (csv: string) => readTable(csv).rows;

describe('csv', () => {
  it('reads quoted fields containing commas and newlines', () => {
    const grid = parseCsv('a,b\n"x,1","line\nbreak"\n');
    expect(grid).toEqual([
      ['a', 'b'],
      ['x,1', 'line\nbreak'],
    ]);
  });

  it('treats "" inside a quoted field as one literal quote', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  it('handles CRLF, a trailing newline and Excel’s byte order mark', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('normalises header names so "Legal Name" and legal_name are one column', () => {
    expect(readTable('Legal Name,BASE-CITY\nSharma,Pune').rows[0]).toEqual({
      legal_name: 'Sharma',
      base_city: 'Pune',
    });
  });
});

describe('ordering — part 12 §4', () => {
  it('lets clients import into an empty database', () => {
    expect(missingDependencies('clients', { clients: 0, vendors: 0 })).toEqual([]);
  });

  it('names clients as the missing dependency for vendors', () => {
    expect(missingDependencies('vendors', { clients: 0, vendors: 0 })).toEqual(['clients']);
  });

  it('names both for opening balances, and neither once they exist', () => {
    expect(missingDependencies('opening-balances', { clients: 0, vendors: 0 })).toEqual(['clients', 'vendors']);
    expect(missingDependencies('opening-balances', { clients: 3, vendors: 9 })).toEqual([]);
  });

  it('recognises exactly the three documented sets', () => {
    expect([...IMPORT_SETS]).toEqual(['clients', 'vendors', 'opening-balances']);
    expect(isImportSet('vendors')).toBe(true);
    expect(isImportSet('trips')).toBe(false);
  });
});

describe('vendors — BR-01 is not bypassable by CSV', () => {
  const header = 'code,legal_name,party_type,base_city,phone,tds_declaration,status';

  it('lands an ACTIVE row at PENDING_VERIFICATION and says so in the report', () => {
    const r = validate('vendors', table(`${header}\nV-1,Sharma Transport,VENDOR,Pune,9880000001,yes,ACTIVE`));

    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].status).toBe('PENDING_VERIFICATION');
    expect(r.report.rejects).toEqual([
      { row: 2, reason: 'status=ACTIVE downgraded to PENDING_VERIFICATION (BR-01)' },
    ]);
  });

  it('leaves an explicitly PENDING_VERIFICATION row alone and silent', () => {
    const r = validate('vendors', table(`${header}\nV-1,Sharma,VENDOR,Pune,9880000001,yes,PENDING_VERIFICATION`));
    expect(r.accepted[0].status).toBe('PENDING_VERIFICATION');
    expect(r.report.rejects).toEqual([]);
  });

  it('rejects a row with no TDS declaration (BR-03)', () => {
    const r = validate('vendors', table(`${header}\nV-1,Sharma,VENDOR,Pune,9880000001,,DRAFT`));
    expect(r.accepted).toHaveLength(0);
    expect(r.report.rejects[0].reason).toBe('TDS declaration missing (BR-03)');
  });

  it('rejects a duplicate phone number but keeps the first row', () => {
    const r = validate(
      'vendors',
      table(`${header}\nV-1,Sharma,VENDOR,Pune,9880000001,yes,DRAFT\nV-2,Bhagwati,VENDOR,Nashik,9880000001,yes,DRAFT`),
    );
    expect(r.accepted).toHaveLength(1);
    expect(r.report.rejects).toEqual([{ row: 3, reason: 'Duplicate phone number "9880000001"' }]);
  });

  it('names every missing required column at once rather than one per pass', () => {
    const r = validate('vendors', table(`${header}\n,,VENDOR,,9880000002,yes,DRAFT`));
    expect(r.report.rejects[0].reason).toBe('Missing required columns: code, legal_name, base_city');
  });

  it('rejects an out-of-range advance percentage', () => {
    const r = validate(
      'vendors',
      table(`${header},advance_pct\nV-1,Sharma,VENDOR,Pune,9880000001,yes,DRAFT,140`),
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.report.rejects[0].reason).toContain('advance_pct must be between 0 and 100');
  });
});

describe('clients', () => {
  const header = 'code,name,billing_city,engagement,credit_days';

  it('accepts a client with no rate card lane', () => {
    const r = validate('clients', table(`${header}\nC-1,Berger Paints,Pune,CONTRACT,30`));
    expect(r.report.rejects).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ code: 'C-1', creditDays: 30, lane: null });
  });

  it('carries a complete rate card lane through', () => {
    const r = validate(
      'clients',
      table(
        `${header},lane_origin,lane_destination,lane_truck_type,lane_rate_paise,lane_valid_from\n` +
          `C-1,Berger,Pune,CONTRACT,30,Nagpur,Hyderabad,32ft,4500000,2026-09-01`,
      ),
    );
    expect(r.report.rejects).toEqual([]);
    expect(r.accepted[0].lane).toMatchObject({ origin: 'Nagpur', ratePaise: 4500000, validTo: null });
  });

  it('rejects a half-filled lane rather than importing a client without its rate', () => {
    const r = validate(
      'clients',
      table(`${header},lane_origin,lane_destination\nC-1,Berger,Pune,CONTRACT,30,Nagpur,Hyderabad`),
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.report.rejects[0].reason).toContain('Rate card lane is incomplete');
  });

  it('rejects an unknown engagement and a duplicate code', () => {
    const r = validate(
      'clients',
      table(`${header}\nC-1,Berger,Pune,RETAINER,30\nC-2,Asian,Nashik,SPOT,0\nC-2,Asian again,Nashik,SPOT,0`),
    );
    expect(r.accepted).toHaveLength(1);
    expect(r.report.rejects.map((x) => x.row)).toEqual([2, 4]);
  });
});

describe('opening balances — the control total decides', () => {
  const header = 'kind,reference,amount_paise';

  it('reconciles when the supplied total matches the rows', () => {
    const r = validate(
      'opening-balances',
      table(`${header}\nADVANCE,TRP-1,100000\nINVOICE,NEX-1,250000\nCONTROL_TOTAL,file,350000`),
    );
    expect(r.report.controlTotals).toEqual({ suppliedPaise: 350000, computedPaise: 350000, reconciles: true });
    expect(r.aborted).toBe(false);
    expect(r.accepted).toHaveLength(2);
  });

  it('aborts the entire import when it does not, carrying nothing forward', () => {
    const r = validate(
      'opening-balances',
      table(`${header}\nADVANCE,TRP-1,100000\nINVOICE,NEX-1,250000\nCONTROL_TOTAL,file,999999`),
    );
    expect(r.report.controlTotals).toMatchObject({ computedPaise: 350000, reconciles: false });
    expect(r.aborted).toBe(true);
    expect(r.accepted).toEqual([]);
  });

  it('refuses a file that supplies no control total at all', () => {
    const r = validate('opening-balances', table(`${header}\nADVANCE,TRP-1,100000`));
    expect(r.aborted).toBe(true);
    expect(r.accepted).toEqual([]);
    expect(r.report.rejects[0].reason).toContain('No CONTROL_TOTAL row');
  });

  it('refuses a second control total rather than picking one', () => {
    const r = validate(
      'opening-balances',
      table(`${header}\nADVANCE,TRP-1,100000\nCONTROL_TOTAL,file,100000\nCONTROL_TOTAL,again,100000`),
    );
    expect(r.report.rejects.some((x) => x.reason.includes('More than one CONTROL_TOTAL'))).toBe(true);
  });

  it('does not count the control total as an imported row', () => {
    const r = validate('opening-balances', table(`${header}\nADVANCE,TRP-1,100000\nCONTROL_TOTAL,file,100000`));
    expect(r.report.rowCount).toBe(1);
  });
});

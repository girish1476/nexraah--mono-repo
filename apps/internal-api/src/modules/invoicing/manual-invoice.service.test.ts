import { describe, expect, it } from 'vitest';
import { InvoicingService } from './invoicing.service';
import { sampleManual } from '../../common/manual-invoice.sample';

/** An in-memory invoices table, numbering series and audit log — enough for the manual paths. */
function setup() {
  const rows = new Map<string, Record<string, any>>();
  let next = 1;
  const audit: string[] = [];
  const trx = {};
  const repo = {
    transaction: () => ({ execute: (fn: (t: unknown) => unknown) => fn(trx) }),
    findClientById: async (id: string) => (id === 'c1' ? { id: 'c1', name: 'Lifecycle Steels' } : undefined),
    insertInvoiceDraft: async (_t: unknown, row: Record<string, any>) => {
      const stored = { ...row, manual: JSON.parse(row.manual), extra_charges: JSON.parse(row.extra_charges), status: 'DRAFT', received: 0, tax_mechanism: 'REVERSE_CHARGE', cancel_reason: null, sac_code: null, details: null };
      rows.set(row.id, stored);
      return stored;
    },
    findByIdForUpdate: async (_t: unknown, id: string) => rows.get(id),
    updateInvoice: async (_t: unknown, id: string, patch: Record<string, any>) => {
      const r = rows.get(id)!;
      Object.assign(r, patch, patch.manual ? { manual: JSON.parse(patch.manual) } : {}, patch.extra_charges ? { extra_charges: JSON.parse(patch.extra_charges) } : {});
      return r;
    },
    invoiceTripIds: async () => [],
    markTripsBilled: async () => undefined,
  };
  const numbering = { issue: async () => `NEX-INV-${String(next++).padStart(6, '0')}` };
  const auditService = { record: async (_t: unknown, _a: unknown, e: { action: string }) => void audit.push(e.action) };
  const service = new InvoicingService(repo as never, numbering as never, auditService as never, {} as never);
  return { service, rows, audit };
}

const admin = { role: 'ADMIN', userId: 'u1' } as never;
const finance = { role: 'FINANCE', userId: 'u2' } as never;

describe('manual invoices', () => {
  it('are for administrators only', async () => {
    await expect(setup().service.createManual({ ...sampleManual(), issue: true } as never, finance)).rejects.toMatchObject({ status: 403 });
  });

  it('take their lines as the freight, round the total, and number it when issued', async () => {
    const { service, rows } = setup();
    const inv = await service.createManual({ ...sampleManual(), issue: true } as never, admin);
    expect(inv).toMatchObject({ code: 'NEX-INV-000001', status: 'ISSUED', freightPaise: 4_000_050, totalPaise: 4_150_100, roundOffPaise: 50 });
    expect(inv.manual).toMatchObject({ vehicleNo: 'KA 01 AB 4321', grossWeightKg: 21000, placeOfSupply: 'Karnataka' });
    expect(inv.manual?.items[0].amountPaise).toBe(4_000_050);
    expect([...rows.values()][0].manual.consignee.name).toBe('Chennai Fabricators');
  });

  it('in bulk, save all or none, and say what is wrong with each row', async () => {
    const { service, rows } = setup();
    const good = sampleManual();
    const noTruck = { ...sampleManual(), vehicleNo: '' };
    const noClient = { ...sampleManual(), clientId: 'c-unknown' };
    const err = await service.createManualBulk({ invoices: [good, noTruck, noClient], issue: true } as never, admin).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toContain('2 of 3 invoices cannot be saved yet, so none were');
    expect(err.message).toContain('Row 2: Vehicle number is missing');
    expect(err.message).toContain('Row 3: Client is not on the system');
    expect(rows.size).toBe(0);

    const made = await service.createManualBulk({ invoices: [good, good, good], issue: true } as never, admin);
    expect(made.map((i) => i.code)).toEqual(['NEX-INV-000001', 'NEX-INV-000002', 'NEX-INV-000003']);
  });

  it('a draft can be corrected in the builder and issued; the ordinary edit refuses it', async () => {
    const { service } = setup();
    const draft = await service.createManual(sampleManual() as never, admin);
    expect(draft).toMatchObject({ code: null, status: 'DRAFT' });
    const fixed = await service.updateManual(draft.id, { ...sampleManual(), grossWeightKg: 22000, issue: true } as never, admin);
    expect(fixed).toMatchObject({ status: 'ISSUED', code: 'NEX-INV-000001' });
    expect(fixed.manual?.grossWeightKg).toBe(22000);
    await expect(service.update(draft.id, { freightPaise: 1 } as never, admin)).rejects.toMatchObject({ status: 409 });
  });
});

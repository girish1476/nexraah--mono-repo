import { describe, expect, it } from 'vitest';
import { LeadsService } from './leads.service';

const VENDOR = '11111111-1111-4111-8111-111111111111';
const OTHER_VENDOR = '22222222-2222-4222-8222-222222222222';

function setup(lead: Record<string, unknown>, opts: { vendors?: string[]; linkedElsewhere?: { id: string; code: string } } = {}) {
  const row = {
    id: 'l1',
    code: 'LD-0001',
    name: 'Sri Balaji Transport',
    city: 'Chakrapuram',
    source: 'INBOUND',
    party_type: 'VENDOR',
    trucks_claimed: 0,
    phone: '9876543210',
    stage: 'NEW',
    notes: null,
    converted_vendor_id: null,
    ...lead,
  };
  const repo = {
    findById: async () => row,
    findByIdJoined: async () => ({ ...row, converted_vendor_code: null, converted_vendor_name: null }),
    vendorExists: async (id: string) => (opts.vendors ?? [VENDOR]).includes(id),
    findByConvertedVendor: async () => opts.linkedElsewhere,
    update: async (_id: string, patch: Record<string, unknown>) => Object.assign(row, patch),
  };
  return { row, service: new LeadsService(repo as never, {} as never) };
}

describe('editing a lead', () => {
  it('changes every detail entered when the lead was added', async () => {
    const { service } = setup({});
    const out = await service.update('l1', {
      name: 'Sri Balaji Transport Co',
      city: 'Tirupati',
      phone: '9123456780',
      source: 'REFERRAL',
      partyType: 'OWNER',
      trucksClaimed: 6,
      notes: 'Runs Tirupati → Chennai',
    });
    expect(out).toMatchObject({
      name: 'Sri Balaji Transport Co',
      city: 'Tirupati',
      phone: '9123456780',
      source: 'REFERRAL',
      partyType: 'OWNER',
      trucksClaimed: 6,
      notes: 'Runs Tirupati → Chennai',
    });
  });

  it('refuses Converted picked by hand with no transporter behind it', async () => {
    const { service } = setup({});
    await expect(service.update('l1', { stage: 'CONVERTED' })).rejects.toMatchObject({ status: 400 });
  });

  it('linking the transporter it became converts the lead', async () => {
    const { row, service } = setup({ stage: 'CONVERTED' });
    const out = await service.update('l1', { convertedVendorId: VENDOR });
    expect(row).toMatchObject({ stage: 'CONVERTED', converted_vendor_id: VENDOR });
    expect(out.convertedVendorId).toBe(VENDOR);
  });

  it('will not link a transporter that does not exist, or one another lead already became', async () => {
    await expect(setup({}, { vendors: [] }).service.update('l1', { convertedVendorId: VENDOR })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      setup({}, { linkedElsewhere: { id: 'l2', code: 'LD-0002' } }).service.update('l1', { convertedVendorId: VENDOR }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('will not move a converted lead to a different transporter', async () => {
    const { service } = setup({ stage: 'CONVERTED', converted_vendor_id: VENDOR }, { vendors: [VENDOR, OTHER_VENDOR] });
    await expect(service.update('l1', { convertedVendorId: OTHER_VENDOR })).rejects.toMatchObject({ status: 409 });
  });
});

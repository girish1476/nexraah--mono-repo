import { describe, expect, it } from 'vitest';
import { ComplianceService, vendorFileProgress } from './compliance.service';

const v = (kind: string, status = 'VERIFIED') => ({ kind, status });
const ALL_KYC = ['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE'].map((k) => v(k));

describe('a transporter file in the compliance queue', () => {
  it('says what is verified out of what is on file, and is Blocked until activation would pass', () => {
    // Nothing uploaded at all used to read "0 items pending verification".
    expect(vendorFileProgress('VENDOR', [], [])).toEqual({
      note: '0 of 4 identity checks verified · 0 of 0 documents verified',
      ready: false,
    });
    expect(
      vendorFileProgress('VENDOR', [...ALL_KYC.slice(0, 3), v('SELFIE', 'PENDING')], [v('TDS_DECLARATION'), v('BANK_STATEMENT', 'PENDING')]),
    ).toEqual({ note: '3 of 4 identity checks verified · 1 of 2 documents verified', ready: false });
  });

  it('is Ready with every identity check, both standing papers and one licence verified', () => {
    const docs = [v('TDS_DECLARATION'), v('BANK_STATEMENT'), v('UDYAM')];
    expect(vendorFileProgress('VENDOR', ALL_KYC, docs).ready).toBe(true);
    // An owner needs the RC itself; a licence will not do.
    expect(vendorFileProgress('OWNER', ALL_KYC, docs).ready).toBe(false);
    expect(vendorFileProgress('OWNER', ALL_KYC, [...docs, v('RC')]).ready).toBe(true);
  });
});

describe('the queues', () => {
  it('reads like the demo: Vendor files, Open file, and trip papers Blocking money from day one', async () => {
    const now = new Date().toISOString();
    const repo = {
      pendingVendorFiles: async () => [{ id: 'v1', code: 'VND-0002', legalName: 'Karnataka Roadways', partyType: 'VENDOR', createdAt: now }],
      papersFor: async () => ({ kyc: [{ vendorId: 'v1', kind: 'PAN', status: 'VERIFIED' }], documents: [] }),
      clientsWithoutRateCards: async () => [{ id: 'c1', code: 'CLT-0001', name: 'Lifecycle Steels', createdAt: now }],
      pendingTripDocuments: async () => [{ tripId: 't1', tripCode: '4473', lane: 'Bengaluru → Chennai', pendingCount: 2, oldestAt: now }],
    };
    const [files, contracts, trips] = await new ComplianceService(repo as never).queues();
    expect(files.name).toBe('Vendor files');
    expect(files.rows[0]).toMatchObject({
      note: '1 of 4 identity checks verified · 0 of 0 documents verified',
      flag: 'Blocked',
      action: 'Open file',
    });
    expect(contracts.rows[0]).toMatchObject({ flag: 'No lanes priced', action: 'Decide' });
    expect(trips.rows[0]).toMatchObject({
      note: '2 document(s) uploaded and waiting · blocking the advance',
      flag: 'Blocking money',
      tone: 'red',
    });
  });
});

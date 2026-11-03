import { describe, expect, it } from 'vitest';
import { vendorFileGaps } from './vendor-file';

const name = (kind: string) => kind.replace(/_/g, ' ');
const verifiedKyc = ['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE'].map((kind) => ({ kind, status: 'VERIFIED' }));
const others = [
  { kind: 'TDS_DECLARATION', status: 'VERIFIED' },
  { kind: 'BANK_STATEMENT', status: 'VERIFIED' },
  { kind: 'TRANSPORTER_AGREEMENT', status: 'VERIFIED' },
];
const legal = (statuses: Record<string, string>) =>
  ['TRADE_LICENCE', 'LABOUR_LICENCE', 'RC', 'UDYAM'].map((kind) => ({ kind, status: statuses[kind] ?? 'MISSING' }));
const gaps = (partyType: string, statuses: Record<string, string>) =>
  vendorFileGaps({ partyType, kyc: verifiedKyc, documents: [...legal(statuses), ...others] }, name).map((g) => g.label);

describe('the licence or registration a transporter needs', () => {
  it('any one verified is enough; the other three are not asked for', () => {
    expect(gaps('VENDOR', { TRADE_LICENCE: 'VERIFIED' })).toEqual([]);
    expect(gaps('VENDOR', { RC: 'VERIFIED' })).toEqual([]);
  });

  it('none at all is one gap, not four', () => {
    expect(gaps('VENDOR', {})).toEqual([
      'No licence or registration on file — any one of trade licence, labour licence, RC or Udyam',
    ]);
  });

  it('one uploaded and not yet checked waits for Compliance', () => {
    expect(gaps('VENDOR', { LABOUR_LICENCE: 'PENDING' })).toEqual(['LABOUR LICENCE pending']);
    expect(gaps('VENDOR', { TRADE_LICENCE: 'VERIFIED', UDYAM: 'PENDING' })).toEqual(['UDYAM pending']);
  });

  it('a rejected one does not hold up a transporter who has another', () => {
    expect(gaps('VENDOR', { TRADE_LICENCE: 'VERIFIED', LABOUR_LICENCE: 'REJECTED' })).toEqual([]);
    expect(gaps('VENDOR', { LABOUR_LICENCE: 'REJECTED' })).toHaveLength(1);
  });

  it('an Owner needs the RC itself', () => {
    expect(gaps('OWNER', { TRADE_LICENCE: 'VERIFIED' })).toEqual(['RC not on file']);
    expect(gaps('OWNER', { RC: 'REJECTED' })).toEqual(['RC rejected']);
    expect(gaps('OWNER', { RC: 'PENDING' })).toEqual(['RC pending']);
    expect(gaps('OWNER', { RC: 'VERIFIED' })).toEqual([]);
  });

  it('every other paper and identity check is still needed', () => {
    const file = vendorFileGaps(
      {
        partyType: 'VENDOR',
        kyc: [{ kind: 'PAN', status: 'PENDING' }],
        documents: [{ kind: 'RC', status: 'VERIFIED' }, { kind: 'TRANSPORTER_AGREEMENT', status: 'MISSING' }],
      },
      name,
    );
    expect(file.map((g) => g.label)).toEqual(['PAN not verified', 'TRANSPORTER AGREEMENT not on file']);
  });
});

import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, UPI_ID_RE } from './integrations';
import { parsePincode } from './pincode';
import { laneEnds, parseOsrmKm } from './road-distance';
import { upiLink } from './upi';
import { partyState, stateFromGstin } from './gst-state';

describe('PIN code lookup', () => {
  it('reads India Post’s answer into a state, district and its post offices', () => {
    const body = [
      {
        Status: 'Success',
        PostOffice: [
          { Name: 'Atchutapuram', District: 'Visakhapatnam', State: 'Andhra Pradesh' },
          { Name: 'Chodapalle', District: 'Visakhapatnam', State: 'Andhra Pradesh' },
          { Name: 'Atchutapuram', District: 'Visakhapatnam', State: 'Andhra Pradesh' },
        ],
      },
    ];
    expect(parsePincode(body)).toEqual({ state: 'Andhra Pradesh', district: 'Visakhapatnam', places: ['Atchutapuram', 'Chodapalle'] });
  });

  it('knows an unknown PIN code when it sees one', () => {
    expect(parsePincode([{ Status: 'Error', PostOffice: null }])).toBeNull();
    expect(parsePincode('nonsense')).toBeNull();
  });
});

describe('road distance', () => {
  it('turns OSRM’s metres into whole kilometres', () => {
    expect(parseOsrmKm({ code: 'Ok', routes: [{ distance: 1_743_723.7 }] })).toBe(1744);
    expect(parseOsrmKm({ code: 'NoRoute', routes: [] })).toBeNull();
  });

  it('splits a lane into its two ends however it was written', () => {
    expect(laneEnds('Nashik → Kolkata')).toEqual(['Nashik', 'Kolkata']);
    expect(laneEnds('Bengaluru -> Chennai')).toEqual(['Bengaluru', 'Chennai']);
    expect(laneEnds('Navi Mumbai - Pune')).toEqual(['Navi Mumbai', 'Pune']);
  });
});

describe('UPI payment code', () => {
  it('is a standard UPI link for the amount due, saying which invoice it pays', () => {
    expect(upiLink({ vpa: 'nexraah@hdfcbank', payeeName: 'Nexraah Logistics' }, 18_850_000, 'Invoice NEX-INV-000412')).toBe(
      'upi://pay?pa=nexraah%40hdfcbank&pn=Nexraah%20Logistics&am=188500.00&cu=INR&tn=Invoice%20NEX-INV-000412',
    );
  });

  it('takes a UPI ID that reads like name@bank, and nothing else', () => {
    expect(['nexraah@hdfcbank', 'accounts.nexraah@okicici', '9876543210@ybl'].every((v) => UPI_ID_RE.test(v))).toBe(true);
    expect(['nexraah', 'nexraah@', '@hdfcbank', 'nex raah@hdfc'].some((v) => UPI_ID_RE.test(v))).toBe(false);
  });

  it('is on the Integrations screen with the two settings it needs', () => {
    const upi = INTEGRATIONS.find((i) => i.id === 'upi');
    expect(upi?.fields.map((f) => f.key)).toEqual(['vpa', 'payeeName']);
    expect(INTEGRATIONS.filter((i) => ['pincode', 'distance', 'upi'].includes(i.id)).every((i) => i.canSwitchOff)).toBe(true);
  });
});

describe('the GST state on a lorry receipt', () => {
  it('comes from the one shared list, and still knows Andhra Pradesh’s old code', () => {
    expect(stateFromGstin('37AAKCN9322K1ZY')).toBe('Andhra Pradesh');
    expect(stateFromGstin('28AAKCN9322K1ZY')).toBe('Andhra Pradesh');
    expect(stateFromGstin('19AAACB2545C1Z9')).toBe('West Bengal');
    expect(partyState({ state: 'Kerala', gstin: '19AAACB2545C1Z9' })).toBe('Kerala');
    expect(stateFromGstin('')).toBe('');
  });
});

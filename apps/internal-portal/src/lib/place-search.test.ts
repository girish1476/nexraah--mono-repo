import { describe, expect, it } from 'vitest';
import { parsePhoton, photonLabel } from './place-search';

describe('place search — reading Photon’s answer', () => {
  it('names a place by name, town and state, each once', () => {
    expect(photonLabel({ name: 'Kurnool', county: 'Kurnool Mandal', state: 'Andhra Pradesh' })).toBe(
      'Kurnool, Kurnool Mandal, Andhra Pradesh',
    );
    expect(photonLabel({ name: 'Nagpur', city: 'Nagpur', state: 'Maharashtra' })).toBe('Nagpur, Maharashtra');
  });

  it('turns features into points (Photon gives longitude first), India only, no repeats', () => {
    const hits = parsePhoton({
      features: [
        { properties: { name: 'Kurnool', state: 'Andhra Pradesh', countrycode: 'IN' }, geometry: { coordinates: [78.0425373, 15.8309251] } },
        { properties: { name: 'Kurnool', state: 'Andhra Pradesh', countrycode: 'IN' }, geometry: { coordinates: [78.1, 15.9] } },
        { properties: { name: 'Kathmandu', countrycode: 'NP' }, geometry: { coordinates: [85.3, 27.7] } },
        { properties: { name: 'No point' } },
      ],
    });
    expect(hits).toEqual([{ label: 'Kurnool, Andhra Pradesh', lat: 15.830925, lng: 78.042537 }]);
  });

  it('gives nothing for an answer it cannot read', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ message: 'error' })).toEqual([]);
  });
});

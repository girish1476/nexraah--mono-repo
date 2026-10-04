import { describe, expect, it } from 'vitest';
import { placeQuery, placeText, routeMapSrc } from './route-map';

describe('a typed place is a location, not a search', () => {
  it('names the country, so a town is not mistaken for a shop of the same name', () => {
    expect(placeText('Thanjavur')).toBe('Thanjavur, India');
    expect(placeText('  thanjavuru  ')).toBe('thanjavuru, India');
    expect(placeText('Sinnar MIDC, Nashik')).toBe('Sinnar MIDC, Nashik, India');
  });

  it('leaves coordinates and places that already name India alone', () => {
    expect(placeText('10.7870, 79.1378')).toBe('10.7870,79.1378');
    expect(placeText('Thanjavur, Tamil Nadu, India')).toBe('Thanjavur, Tamil Nadu, India');
    expect(placeText('')).toBe('India');
    expect(placeText(null)).toBe('India');
  });

  it('uses the exact pin when there is one, else the address, else the city', () => {
    expect(placeQuery({ address: 'Gate 2', lat: 10.787, lng: 79.1378 }, 'Thanjavur')).toBe('10.787,79.1378');
    expect(placeQuery({ address: 'Kaveri depot, Dankuni', lat: null, lng: null }, 'Kolkata')).toBe('Kaveri depot, Dankuni, India');
    expect(placeQuery(null, 'Thanjavur')).toBe('Thanjavur, India');
  });

  it('puts the qualified names in the map address', () => {
    const src = routeMapSrc(placeQuery(null, 'Nashik'), placeQuery(null, 'Thanjavur'), placeText('Salem'));
    expect(decodeURIComponent(src)).toContain('saddr=Nashik, India');
    expect(decodeURIComponent(src)).toContain('Salem, India+to:Thanjavur, India');
  });
});

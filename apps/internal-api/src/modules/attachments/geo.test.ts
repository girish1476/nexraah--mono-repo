import { describe, it, expect } from 'vitest';
import { parseGeo } from './geo';
import { DomainException } from '../../common/domain-exception';

describe('parseGeo — the geotag both upload paths used to drop', () => {
  it('keeps a valid coordinate pair', () => {
    expect(parseGeo('19.9975', '73.7898')).toEqual({ lat: 19.9975, lng: 73.7898 });
  });

  it('answers null when either half is absent — "no geotag", for kinds that never carry one', () => {
    expect(parseGeo(undefined, undefined)).toBeNull();
    expect(parseGeo('19.9975', undefined)).toBeNull();
    expect(parseGeo('', '73.7898')).toBeNull();
  });

  it('refuses a point that is not on Earth', () => {
    expect(() => parseGeo('91', '73.7')).toThrow(DomainException);
    expect(() => parseGeo('19.9', '181')).toThrow(DomainException);
    expect(() => parseGeo('not-a-number', '73.7')).toThrow(DomainException);
  });

  it('accepts the poles and the antimeridian — the boundary is inclusive', () => {
    expect(parseGeo('-90', '180')).toEqual({ lat: -90, lng: 180 });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { cleanServedCities } from './branch-city';
import { BranchesService } from './branches.service';

describe('the towns a branch serves', () => {
  it('are trimmed, blanks dropped, and a repeat in any case kept once', () => {
    expect(cleanServedCities([' Achuthapuram ', '', 'anakapalli', 'ACHUTHAPURAM', 'Sabbavaram  Junction'])).toEqual([
      'Achuthapuram',
      'anakapalli',
      'Sabbavaram Junction',
    ]);
  });
});

describe('one town, one branch', () => {
  const branches = [
    { id: 'vis', code: 'VIS', name: 'Visakhapatnam', city: 'Visakhapatnam', catchment_km: 150, served_cities: ['Achuthapuram'], supply_source: null, supply_remarks: null },
    { id: 'vja', code: 'VJA', name: 'Vijayawada', city: 'Vijayawada', catchment_km: 150, served_cities: [], supply_source: null, supply_remarks: null },
  ];
  const service = () => {
    const updated = vi.fn(async (_db: unknown, id: string, patch: Record<string, unknown>) => ({ ...branches.find((b) => b.id === id)!, ...patch }));
    const repo = {
      findAll: async () => branches,
      findById: async (id: string) => branches.find((b) => b.id === id),
      transaction: () => ({ execute: (fn: (trx: unknown) => unknown) => fn({}) }),
      update: updated,
    };
    const audit = { record: vi.fn() };
    return { svc: new BranchesService(repo as never, audit as never), updated };
  };
  const actor = { userId: 'u', role: 'ADMIN' } as never;

  it('refuses a town another branch already serves', async () => {
    await expect(service().svc.update('vja', { servedCities: ['achuthapuram'] }, actor)).rejects.toThrow(ConflictException);
  });

  it('refuses another branch’s own city', async () => {
    await expect(service().svc.update('vja', { servedCities: ['Visakhapatnam'] }, actor)).rejects.toThrow(
      /already served by the Visakhapatnam branch/,
    );
  });

  it('saves the cleaned list, and returns it', async () => {
    const { svc, updated } = service();
    const out = await svc.update('vis', { servedCities: ['Achuthapuram', ' Anakapalli ', 'visakhapatnam'] }, actor);
    expect(updated.mock.calls[0][2].served_cities).toEqual(['Achuthapuram', 'Anakapalli']); // its own city is dropped
    expect(out.servedCities).toEqual(['Achuthapuram', 'Anakapalli']);
  });
});

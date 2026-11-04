import { sql } from 'kysely';

/**
 * Which branch a city belongs to (BR-20, BR-34): the branch whose own city it
 * is, or one that lists it under "Also serves". Case and surrounding spaces
 * are ignored. Used by both derivations so they cannot drift apart.
 */
export function branchServesCity(city: string) {
  const c = city.trim().toLowerCase();
  return sql<boolean>`(lower(trim(branches.city)) = ${c} or exists (select 1 from unnest(branches.served_cities) as town(name) where lower(trim(town.name)) = ${c}))`;
}

/** The towns as typed, trimmed, blanks dropped, repeats (any case) removed. */
export function cleanServedCities(towns: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of towns) {
    const town = raw.trim().replace(/\s+/g, ' ');
    if (!town || seen.has(town.toLowerCase())) continue;
    seen.add(town.toLowerCase());
    out.push(town);
  }
  return out;
}

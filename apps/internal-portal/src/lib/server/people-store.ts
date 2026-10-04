import { findPerson, parsePeople, ROLE_CODES, type Person, type SignInRole } from './sign-in-code';

/**
 * The people an administrator allowed to sign in, kept on the server.
 *
 * SIGNIN_PEOPLE is a list somebody has to edit in the hosting dashboard and
 * redeploy; the Users screen kept its own list in one browser, which the
 * server that emails the codes never saw. This is the shared copy: what an
 * administrator adds on the Users screen is saved here, so that person gets a
 * code on any phone or computer.
 *
 * It is one hash in a hosted Redis reached over its REST API (Upstash, or
 * "Upstash for Redis" added from the Vercel dashboard) — a `fetch`, no client
 * library. Set either pair:
 *
 *   KV_REST_API_URL + KV_REST_API_TOKEN                  (added by Vercel)
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN    (from Upstash itself)
 *
 * Without one, nothing here is used and sign-in is SIGNIN_PEOPLE alone.
 *
 * SIGNIN_PEOPLE still comes first: the people in it can always sign in, with
 * the role it gives them, whatever this list says — so nobody can be locked
 * out of the console from the Users screen.
 */

const KEY = 'nexraah:people';

export interface StoredPerson extends Person {
  /** Branch code, or null for every branch. */
  branch: string | null;
  phone: string | null;
  disabled: boolean;
  addedAt: string;
}

function config(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export function peopleStoreConfigured(): boolean {
  return config() !== null;
}

async function command<T>(args: (string | number)[], fetchImpl: typeof fetch = fetch): Promise<T> {
  const c = config();
  if (!c) throw new Error('The people list is not set up on this deployment.');
  const response = await fetchImpl(c.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(`The people list could not be reached (${response.status}): ${payload.error ?? 'no reason given'}`);
  }
  return payload.result as T;
}

function parseStored(raw: string | null | undefined): StoredPerson | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<StoredPerson>;
    if (typeof p.email !== 'string' || !ROLE_CODES.includes(p.role as SignInRole)) return null;
    return {
      email: p.email,
      role: p.role as SignInRole,
      name: typeof p.name === 'string' && p.name ? p.name : p.email.split('@')[0],
      branch: typeof p.branch === 'string' && p.branch ? p.branch : null,
      phone: typeof p.phone === 'string' && p.phone ? p.phone : null,
      disabled: p.disabled === true,
      addedAt: typeof p.addedAt === 'string' ? p.addedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function storedPerson(email: string, fetchImpl: typeof fetch = fetch): Promise<StoredPerson | null> {
  return parseStored(await command<string | null>(['HGET', KEY, email.trim().toLowerCase()], fetchImpl));
}

export async function listStoredPeople(fetchImpl: typeof fetch = fetch): Promise<StoredPerson[]> {
  // HGETALL answers as a flat [field, value, field, value, …] list.
  const flat = (await command<string[] | null>(['HGETALL', KEY], fetchImpl)) ?? [];
  const people: StoredPerson[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    const person = parseStored(flat[i]);
    if (person) people.push(person);
  }
  return people;
}

export async function saveStoredPerson(person: StoredPerson, fetchImpl: typeof fetch = fetch): Promise<void> {
  await command<number>(['HSET', KEY, person.email, JSON.stringify(person)], fetchImpl);
}

/** True for someone SIGNIN_PEOPLE names — their access is set there and nowhere else. */
export function isFixedPerson(email: string): boolean {
  return !!findPerson(email);
}

export function fixedPeople(): Person[] {
  return parsePeople(process.env.SIGNIN_PEOPLE);
}

/**
 * Who this email signs in as, or undefined when it may not sign in.
 * SIGNIN_PEOPLE first, then the list administrators keep. A store that cannot
 * be reached refuses the people only it knows about, never the fixed ones.
 */
export async function allowedPerson(
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<(Person & { branch: string | null }) | undefined> {
  const fixed = findPerson(email);
  if (fixed) return { ...fixed, branch: null };
  if (!peopleStoreConfigured()) return undefined;
  const stored = await storedPerson(email, fetchImpl);
  if (!stored || stored.disabled) return undefined;
  return { email: stored.email, role: stored.role, name: stored.name, branch: stored.branch };
}

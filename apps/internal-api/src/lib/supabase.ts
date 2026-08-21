import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env';

/**
 * Part 14 §4: the Supabase JS client exists for exactly two things here —
 * verifying an Auth JWT (done with `jose` against JWKS directly, see
 * `lib/jwks.ts`, so this client is not used for that) and signing Storage
 * URLs. Always constructed with the anon key. `SUPABASE_SERVICE_ROLE_KEY` is
 * never read anywhere in this codebase — see `config/env.ts`.
 */
export function createSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

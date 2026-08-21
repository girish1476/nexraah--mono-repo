import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../config/env';

/**
 * Part 14 §4.1: verify against the project's JWKS endpoint, cached, issuer
 * and expiry checked — no per-request call to the Auth admin API. `jose`
 * caches the key set behind `createRemoteJWKSet` and only refetches on a
 * `kid` miss, so one instance per process is what "cached" means here.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(env: Env) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export interface SupabaseJwtClaims extends JWTPayload {
  sub: string;
  email?: string;
}

export async function verifySupabaseJwt(token: string, env: Env): Promise<SupabaseJwtClaims> {
  const { payload } = await jwtVerify(token, getJwks(env), {
    issuer: env.SUPABASE_JWT_ISSUER,
  });
  return payload as SupabaseJwtClaims;
}

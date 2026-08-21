/**
 * The env contract is `docs/specs/internal-spec/14-supabase-setup.md` §9.
 * `ConfigModule.forRoot({ validate })` in app.module.ts runs this against
 * `process.env` at boot — a missing required variable fails startup, not the
 * first request that needs it.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is deliberately never read here. Part 14 §4:
 * nothing in this system holds that key.
 */

const REQUIRED_KEYS = [
  'DATABASE_URL_INTERNAL',
  'DATABASE_URL_PORTAL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_JWT_ISSUER',
  'PORTAL_SERVICE_KEY',
  'STORAGE_BUCKET',
] as const;

export interface Env {
  PORT: number;
  DATABASE_URL_INTERNAL: string;
  DATABASE_URL_PORTAL: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_ISSUER: string;
  PORTAL_SERVICE_KEY: string;
  STORAGE_BUCKET: string;
}

export function validateEnv(config: Record<string, unknown>): Env {
  const missing = REQUIRED_KEYS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `internal-api: missing required environment variable(s): ${missing.join(', ')}. ` +
        `See docs/specs/internal-spec/14-supabase-setup.md §9 and apps/internal-api/.env.example.`,
    );
  }

  if (config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'internal-api: SUPABASE_SERVICE_ROLE_KEY must not be set (part 14 §4). ' +
        'Postgres access is via internal_api/vendor_api logins; Storage and Auth use the anon key only.',
    );
  }

  return {
    PORT: config.PORT ? Number(config.PORT) : 4002,
    DATABASE_URL_INTERNAL: String(config.DATABASE_URL_INTERNAL),
    DATABASE_URL_PORTAL: String(config.DATABASE_URL_PORTAL),
    SUPABASE_URL: String(config.SUPABASE_URL),
    SUPABASE_ANON_KEY: String(config.SUPABASE_ANON_KEY),
    SUPABASE_JWT_ISSUER: String(config.SUPABASE_JWT_ISSUER),
    PORTAL_SERVICE_KEY: String(config.PORTAL_SERVICE_KEY),
    STORAGE_BUCKET: String(config.STORAGE_BUCKET),
  };
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { PORTAL_DB } from '../../db/tokens';
import type { PortalDb } from '../../db/kysely';
import { PORTAL_SYSTEM_USER_EMAIL, PORTAL_SYSTEM_USER_ID_ENV } from './portal.constants';
import { portalError } from './portal.errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `ADR-02` §4: `vendorId` is resolved here, from the JWT subject against
 * `vendor_users`. No header names the vendor.
 *
 * `PORTAL_DB` is `portalPool` (role `vendor_api`) — see
 * `db/portal-db.module.ts`. `vendor_users` and `vendors` both carry a plain
 * `select` grant for that role (`20260814090200` §2), so this join is one of
 * the few portal queries that needs no column list.
 */
@Injectable()
export class PortalIdentityRepository {
  constructor(@Inject(PORTAL_DB) private readonly db: PortalDb) {}

  /**
   * `20260814090100` §vendor_users makes `auth_user_id` the primary key, so
   * "a second row" is unrepresentable and this cannot silently pick one of
   * two vendors for a single login.
   */
  findVendorByAuthUserId(authUserId: string) {
    return this.db
      .selectFrom('vendor_users')
      .innerJoin('vendors', 'vendors.id', 'vendor_users.vendor_id')
      .select([
        'vendor_users.vendor_id as vendorId',
        'vendor_users.auth_user_id as authUserId',
        'vendors.code as code',
        'vendors.legal_name as legalName',
        'vendors.status as status',
      ])
      .where('vendor_users.auth_user_id', '=', authUserId)
      .executeTakeFirst();
  }

  /** Boot-time proof that this module really did get the `vendor_api` login. */
  async currentDatabaseUser(): Promise<string | null> {
    const result = await sql<{ role: string }>`select current_user as role`.execute(this.db);
    return result.rows[0]?.role ?? null;
  }

  /**
   * The `users.id` every portal-originated `attachments` row is attributed to —
   * the "Portal System" row seeded by
   * `20260824090000_c_portal_idempotency.sql`. See
   * `PORTAL_SYSTEM_USER_EMAIL` in `portal.constants.ts` for why this cannot
   * simply be selected: `users` is in `vendor_api`'s blanket `REVOKE ALL`.
   *
   * Resolution order, and the order is the point:
   *
   * 1. `PORTAL_SYSTEM_USER_ID` from the environment — the supported answer on a
   *    correctly granted database, and the only one that costs nothing;
   * 2. failing that, `portal_system_user_id()` (20261104010000) — a definer
   *    function that hands `vendor_api` this one id and nothing else from
   *    `users`. Before it, step 2 was a `select` on `users` that a correctly
   *    granted database refuses, so every portal upload failed wherever the
   *    setting had not been made — and no setup step mentioned it.
   *
   * Cached either way: it never changes within a process, and the fallback must
   * not re-raise a permission error once per upload. Deliberately run OUTSIDE
   * any caller's transaction — a permission error inside one would abort the
   * whole write rather than fall through to the message below.
   */
  async systemUploaderId(): Promise<string> {
    if (this.uploaderId) return this.uploaderId;

    const configured = process.env[PORTAL_SYSTEM_USER_ID_ENV];
    if (configured && UUID.test(configured)) {
      this.uploaderId = configured;
      return this.uploaderId;
    }

    if (!this.uploaderLookupTried) {
      this.uploaderLookupTried = true;
      try {
        const result = await sql<{ id: string | null }>`select public.portal_system_user_id() as id`.execute(this.db);
        const id = result.rows[0]?.id;
        if (id) {
          this.uploaderId = id;
          return this.uploaderId;
        }
      } catch {
        // The function is missing (20261104010000 not applied yet) — the
        // actionable line is the one below.
      }
    }

    this.logger.error(
      `Cannot find the "${PORTAL_SYSTEM_USER_EMAIL}" user, so portal uploads cannot be recorded. ` +
        'Apply the migrations (supabase db push — 20261104010000 adds portal_system_user_id()), ' +
        `or set ${PORTAL_SYSTEM_USER_ID_ENV} to: select id from users where email = '${PORTAL_SYSTEM_USER_EMAIL}'.`,
    );
    // The transporter is told nothing about any of that.
    throw portalError('REQUEST_FAILED');
  }

  private readonly logger = new Logger('PortalIdentityRepository');
  private uploaderId?: string;
  private uploaderLookupTried = false;
}

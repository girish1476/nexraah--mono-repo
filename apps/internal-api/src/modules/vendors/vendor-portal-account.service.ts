import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

export interface ProvisionResult {
  provisioned: boolean;
  reason?: string;
}

/**
 * `POST /vendors/:id/activate` step 2-3 (docs/api/02-vendors-compliance.md):
 * create `vendor_users`, send the first-login SMS. Both are, in real
 * Supabase, admin-privileged operations — minting an auth user on someone
 * else's behalf needs `auth.admin.createUser`, which needs `service_role`.
 *
 * `config/env.ts` makes that key impossible to configure in this codebase —
 * it throws at boot if `SUPABASE_SERVICE_ROLE_KEY` is set at all (part 14
 * §4). That guard is correct for the reason it exists (a service_role
 * Postgres connection bypasses every column GRANT `ADR-02` depends on) but it
 * also forecloses the one legitimate use Auth admin calls would have needed
 * it for. Nothing in the spec set names an alternative (no
 * `SUPABASE_ADMIN_URL`-style separate credential, no invite-link flow).
 *
 * Rather than silently no-op or quietly reach for `service_role` under a
 * different variable name (which would defeat the boot-time check's actual
 * purpose without saying so), this fails **visibly**: the vendor still
 * activates — `BR-01`'s completeness gate is the real control and is fully
 * enforced by `VendorsService.activate()` before this is ever called — but
 * the portal-account step is recorded as pending rather than faked, and a
 * `notifications` row is queued so it is at least visible in the one place
 * ops already looks (part 13's `notification-dispatch` job owns delivery
 * once a real channel exists). Flagging this for a product decision rather
 * than guessing: either a narrowly-scoped Auth Admin API credential gets
 * carved out as an explicit, reviewed exception, or vendor accounts are
 * provisioned by a person from the Supabase dashboard until then.
 */
@Injectable()
export class VendorPortalAccountService {
  private readonly logger = new Logger('VendorPortalAccountService');

  constructor(@Inject(DB) private readonly db: InternalDb) {}

  async provision(vendorId: string, phone: string): Promise<ProvisionResult> {
    this.logger.warn(
      `Portal account provisioning for vendor ${vendorId} requires a Supabase Auth admin ` +
        `capability this deployment does not configure (see this file's header comment). ` +
        `Queuing the first-login notification only; vendor_users has no row yet.`,
    );

    await this.db
      .insertInto('notifications')
      .values({
        event: 'VENDOR_ACTIVATED_PENDING_ACCOUNT',
        channel: 'SMS',
        recipient: phone,
        template_id: 'VENDOR_FIRST_LOGIN', // DLT-registered template, D-31
        payload: JSON.stringify({ vendorId }),
        status: 'PENDING',
      })
      .execute();

    return { provisioned: false, reason: 'SUPABASE_AUTH_ADMIN_NOT_CONFIGURED' };
  }
}

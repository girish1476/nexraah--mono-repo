import { Inject, Injectable } from '@nestjs/common';
import type { PortalDb } from '../../db/kysely';
import { PORTAL_DB } from '../../db/tokens';
import type { PushTarget } from '../notifications/web-push';

/**
 * A transporter's browsers that said yes to notifications — through the
 * restricted `vendor_api` login, like every other portal query. Which vendor a
 * row belongs to comes from the signed-in login (`PortalVendor`), never from the
 * request, and a transporter can only remove its own.
 */
@Injectable()
export class PortalPushRepository {
  constructor(@Inject(PORTAL_DB) private readonly db: PortalDb) {}

  async save(vendorId: string, target: PushTarget, userAgent: string | null) {
    await this.db
      .insertInto('push_subscriptions')
      .values({ vendor_id: vendorId, user_id: null, endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth, user_agent: userAgent })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          vendor_id: vendorId,
          user_id: null,
          p256dh: target.p256dh,
          auth: target.auth,
          user_agent: userAgent,
          updated_at: new Date().toISOString(),
        }),
      )
      .execute();
  }

  async forget(vendorId: string, endpoint: string) {
    await this.db.deleteFrom('push_subscriptions').where('endpoint', '=', endpoint).where('vendor_id', '=', vendorId).execute();
  }
}

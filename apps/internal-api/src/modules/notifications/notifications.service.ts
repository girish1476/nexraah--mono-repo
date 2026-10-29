import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import { EmailNotConfiguredError, sendWithResend } from '../auth/resend';
import { renderEvent, type NotificationEvent, type Rendered } from './notification-events';
import { renderNotificationEmail } from './notification-email';
import { smsGatewayFromEnv, smsTemplates, type SmsGateway } from './sms';
import { sendPush, vapidFromEnv, type PushTarget, type VapidKeys } from './web-push';

/**
 * Notifications, from the moment something happens to the moment it lands.
 *
 * `raise()` is called inside the transaction that made the change — an award,
 * a payment, a POD decision — so a notification exists only if the change
 * does. It works out who should hear (a transporter, named people, or every
 * active member of staff who holds a permission) and queues one row per
 * channel per recipient: email where there is an address, browser push where
 * a browser said yes, SMS once a gateway is set up. A key per event stops a
 * re-run from queueing it twice.
 *
 * `dispatch()` — the `notification-dispatch` job, every minute — sends what is
 * due. A channel that is not set up is SKIPPED with the reason, not retried; a
 * failure is retried with growing gaps (2, 4, 8, 16 minutes) and then FAILED.
 * A browser that has withdrawn is forgotten.
 */

export type NotifyTo =
  | { vendorId: string }
  | { userIds: string[] }
  /** Every active member of staff whose role holds this permission at EDIT. */
  | { permission: string };

type Channel = 'EMAIL' | 'PUSH' | 'SMS';

interface Queued {
  channel: Channel;
  recipient: string;
}

export interface Senders {
  email: (message: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<{ id: string }>;
  push: (target: PushTarget, message: Record<string, unknown>, keys: VapidKeys) => ReturnType<typeof sendPush>;
  sms: SmsGateway | null;
  vapid: VapidKeys | null;
  smsTemplates: Record<string, string>;
  /** The transporter portal's and the console's addresses, for links. */
  portalUrl: string | null;
  consoleUrl: string | null;
  logoUrl: string | null;
}

const MAX_ATTEMPTS = 5;
const BATCH = 50;

/** Where `EMAIL_TEST_OUTBOX` names a folder, emails are written there instead of sent — for local trials only. */
async function sendEmail(message: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
  const outbox = process.env.EMAIL_TEST_OUTBOX;
  if (outbox) {
    mkdirSync(outbox, { recursive: true });
    writeFileSync(join(outbox, `${message.idempotencyKey}.json`), JSON.stringify(message, null, 2));
    return { id: `outbox:${message.idempotencyKey}` };
  }
  return sendWithResend({ ...message });
}

export function sendersFromEnv(env: NodeJS.ProcessEnv = process.env): Senders {
  const site = (v: string | undefined) => (v && /^https?:\/\//.test(v.trim()) ? v.trim().replace(/\/$/, '') : null);
  return {
    email: sendEmail,
    push: sendPush,
    sms: smsGatewayFromEnv(env),
    vapid: vapidFromEnv(env),
    smsTemplates: smsTemplates(env),
    portalUrl: site(env.PORTAL_PUBLIC_URL),
    consoleUrl: site(env.CONSOLE_PUBLIC_URL),
    logoUrl: env.EMAIL_LOGO_URL ?? null,
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(@Inject(DB) private readonly db: InternalDb) {}

  // ---- raising -------------------------------------------------------------

  /**
   * Queues `event` for `to`. `key` names this occurrence (`quote.awarded:<quoteId>`);
   * raising the same key again adds nothing. Returns how many rows were queued.
   */
  async raise(
    db: DbExecutor,
    event: NotificationEvent,
    to: NotifyTo,
    data: Record<string, unknown>,
    key: string,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<number> {
    const rendered = renderEvent(event, data);
    const site = 'vendorId' in to ? 'portal' : 'console';
    const queue: Queued[] = [];
    const smsOn = !!smsGatewayFromEnv(env) && !!smsTemplates(env)[event];

    if ('vendorId' in to) {
      const vendor = await db.selectFrom('vendors').select(['id', 'phone', 'email']).where('id', '=', to.vendorId).executeTakeFirst();
      if (!vendor) return 0;
      if (vendor.email?.includes('@')) queue.push({ channel: 'EMAIL', recipient: vendor.email.trim().toLowerCase() });
      const browsers = await db.selectFrom('push_subscriptions').select('id').where('vendor_id', '=', vendor.id).limit(1).execute();
      if (browsers.length) queue.push({ channel: 'PUSH', recipient: `vendor:${vendor.id}` });
      if (smsOn && /^[6-9]\d{9}$/.test(String(vendor.phone ?? '').replace(/\D/g, '').slice(-10))) {
        queue.push({ channel: 'SMS', recipient: String(vendor.phone).replace(/\D/g, '').slice(-10) });
      }
    } else {
      const people = await this.staff(db, to);
      for (const p of people) {
        if (p.email?.includes('@')) queue.push({ channel: 'EMAIL', recipient: p.email.trim().toLowerCase() });
        if (p.hasBrowser) queue.push({ channel: 'PUSH', recipient: `user:${p.id}` });
        if (smsOn && p.phone && /^[6-9]\d{9}$/.test(p.phone.replace(/\D/g, '').slice(-10))) {
          queue.push({ channel: 'SMS', recipient: p.phone.replace(/\D/g, '').slice(-10) });
        }
      }
    }
    if (queue.length === 0) return 0;

    const rows = queue.map((q) => ({
      event,
      channel: q.channel,
      recipient: q.recipient,
      template_id: event,
      payload: JSON.stringify({ event, site, rendered, data }),
      status: 'PENDING',
      dedupe_key: `${key}:${q.channel}:${q.recipient}`,
    }));
    const inserted = await db
      .insertInto('notifications')
      .values(rows)
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning('id')
      .execute();
    return inserted.length;
  }

  /**
   * `raise()` for use inside the transaction that made the change, behind a
   * savepoint: the notification commits with the change, and nothing that goes
   * wrong with it can undo or block the award, payment or decision itself. A
   * failure is logged and the change goes ahead without its notification.
   */
  async raiseSafely(db: DbExecutor, event: NotificationEvent, to: NotifyTo, data: Record<string, unknown>, key: string): Promise<number> {
    const inTransaction = (db as { isTransaction?: boolean }).isTransaction === true;
    try {
      if (inTransaction) await sql`savepoint notify`.execute(db);
      const queued = await this.raise(db, event, to, data, key);
      if (inTransaction) await sql`release savepoint notify`.execute(db);
      return queued;
    } catch (e) {
      if (inTransaction) await sql`rollback to savepoint notify`.execute(db).catch(() => undefined);
      this.logger.error(`could not queue ${event} (${key}): ${(e as Error).message}`);
      return 0;
    }
  }

  private async staff(db: DbExecutor, to: { userIds: string[] } | { permission: string }) {
    let query = db
      .selectFrom('users')
      .select((eb) => [
        'users.id as id',
        'users.email as email',
        'users.phone as phone',
        eb.exists(eb.selectFrom('push_subscriptions').select('push_subscriptions.id').whereRef('push_subscriptions.user_id', '=', 'users.id')).as('hasBrowser'),
      ])
      .where('users.status', '=', 'ACTIVE');
    if ('userIds' in to) {
      if (to.userIds.length === 0) return [];
      query = query.where('users.id', 'in', to.userIds);
    } else {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('role_permissions')
            .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
            .select('role_permissions.role_id')
            .whereRef('role_permissions.role_id', '=', 'users.role_id')
            .where('permissions.code', '=', to.permission)
            .where('role_permissions.level', '=', 'EDIT'),
        ),
      );
    }
    return query.execute();
  }

  // ---- browsers ------------------------------------------------------------

  /** A member of staff's browser said yes. One row per browser; the same browser again just updates it. */
  async saveStaffBrowser(userId: string, target: PushTarget, userAgent: string | null) {
    await this.db
      .insertInto('push_subscriptions')
      .values({ user_id: userId, vendor_id: null, endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth, user_agent: userAgent })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          user_id: userId,
          vendor_id: null,
          p256dh: target.p256dh,
          auth: target.auth,
          user_agent: userAgent,
          updated_at: new Date().toISOString(),
        }),
      )
      .execute();
  }

  async forgetStaffBrowser(userId: string, endpoint: string) {
    await this.db.deleteFrom('push_subscriptions').where('endpoint', '=', endpoint).where('user_id', '=', userId).execute();
  }

  /** "Notifications are on" — straight to the browser that just said yes, so the person sees it work. */
  async confirmBrowser(target: PushTarget, senders: Senders = sendersFromEnv()) {
    if (!senders.vapid) return { ok: false as const, message: 'Push is not set up on the server (VAPID keys).' };
    try {
      const outcome = await senders.push(
        target,
        { title: 'Notifications are on', body: 'This device will now be told about the things that need you.', url: '/' },
        senders.vapid,
      );
      return outcome.ok ? { ok: true as const } : { ok: false as const, message: outcome.message };
    } catch (e) {
      // The browser's push address could not be reached at all — saved anyway; the sending job will try again.
      return { ok: false as const, message: (e as Error).message };
    }
  }

  // ---- sending ---------------------------------------------------------------

  /** Sends what is due. Safe to run from several processes: rows are claimed with SKIP LOCKED. */
  async dispatch(senders: Senders = sendersFromEnv(), now = new Date()) {
    const claimed = await sql<{
      id: string;
      channel: Channel;
      recipient: string;
      event: string;
      payload: unknown;
      attempts: number;
    }>`
      update notifications set status = 'SENDING', claimed_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
       where id in (
         select id from notifications
          where (status = 'PENDING' and (next_attempt_at is null or next_attempt_at <= ${now.toISOString()}))
             or (status = 'SENDING' and claimed_at < ${new Date(now.getTime() - 10 * 60_000).toISOString()})
          order by created_at
          limit ${BATCH}
          for update skip locked)
      returning id, channel, recipient, event, payload, attempts`.execute(this.db);

    const tally = { sent: 0, skipped: 0, retrying: 0, failed: 0 };
    for (const row of claimed.rows) {
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as {
        site: 'portal' | 'console';
        rendered: Rendered;
      };
      let outcome: { status: 'SENT'; ref: string } | { status: 'SKIPPED'; reason: string } | { status: 'ERROR'; reason: string };
      try {
        outcome = await this.sendOne(row, payload, senders);
      } catch (e) {
        outcome =
          e instanceof EmailNotConfiguredError
            ? { status: 'SKIPPED', reason: e.message }
            : { status: 'ERROR', reason: (e as Error).message?.slice(0, 500) ?? 'unknown error' };
      }
      const at = new Date().toISOString();
      if (outcome.status === 'SENT') {
        tally.sent += 1;
        await this.db
          .updateTable('notifications')
          .set({ status: 'SENT', sent_at: at, provider_ref: outcome.ref, attempts: row.attempts + 1, last_error: null, updated_at: at })
          .where('id', '=', row.id)
          .execute();
      } else if (outcome.status === 'SKIPPED') {
        tally.skipped += 1;
        await this.db.updateTable('notifications').set({ status: 'SKIPPED', last_error: outcome.reason, updated_at: at }).where('id', '=', row.id).execute();
      } else {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        if (giveUp) tally.failed += 1;
        else tally.retrying += 1;
        await this.db
          .updateTable('notifications')
          .set({
            status: giveUp ? 'FAILED' : 'PENDING',
            attempts,
            last_error: outcome.reason,
            next_attempt_at: giveUp ? null : new Date(Date.now() + 2 ** attempts * 60_000).toISOString(),
            updated_at: at,
          })
          .where('id', '=', row.id)
          .execute();
        this.logger.warn(`${row.channel} ${row.event} to ${row.recipient}: ${outcome.reason}${giveUp ? ' — giving up' : ''}`);
      }
    }
    return tally;
  }

  private async sendOne(
    row: { id: string; channel: Channel; recipient: string; event: string },
    payload: { site: 'portal' | 'console'; rendered: Rendered },
    senders: Senders,
  ): Promise<{ status: 'SENT'; ref: string } | { status: 'SKIPPED'; reason: string } | { status: 'ERROR'; reason: string }> {
    const { rendered, site } = payload;
    const base = site === 'portal' ? senders.portalUrl : senders.consoleUrl;
    const url = base ? `${base}${rendered.path}` : null;

    if (row.channel === 'EMAIL') {
      const email = renderNotificationEmail({
        rendered,
        url,
        to: row.recipient,
        place: site === 'portal' ? 'Transporter portal' : 'Operations console',
        logoUrl: senders.logoUrl,
      });
      const sent = await senders.email({ to: row.recipient, ...email, idempotencyKey: `notification-${row.id}` });
      return { status: 'SENT', ref: sent.id };
    }

    if (row.channel === 'PUSH') {
      if (!senders.vapid) return { status: 'SKIPPED', reason: 'Push is not set up on the server (VAPID keys).' };
      const [kind, id] = row.recipient.split(':');
      const browsers = await this.db
        .selectFrom('push_subscriptions')
        .select(['id', 'endpoint', 'p256dh', 'auth'])
        .where(kind === 'vendor' ? 'vendor_id' : 'user_id', '=', id)
        .execute();
      if (browsers.length === 0) return { status: 'SKIPPED', reason: 'No browser has notifications turned on.' };
      let delivered = 0;
      const errors: string[] = [];
      for (const b of browsers) {
        const outcome = await senders
          .push(b, { title: rendered.title, body: rendered.body, url: rendered.path, tag: row.id }, senders.vapid)
          .catch((e: Error) => ({ ok: false as const, gone: false, status: 0, message: e.message }));
        if (outcome.ok) {
          delivered += 1;
          await this.db.updateTable('push_subscriptions').set({ last_sent_at: new Date().toISOString() }).where('id', '=', b.id).execute();
        } else if (outcome.gone) {
          await this.db.deleteFrom('push_subscriptions').where('id', '=', b.id).execute();
        } else {
          errors.push(outcome.message);
        }
      }
      if (delivered > 0) return { status: 'SENT', ref: `${delivered} of ${browsers.length} browsers` };
      return errors.length ? { status: 'ERROR', reason: errors.join('; ') } : { status: 'SKIPPED', reason: 'Every browser had turned notifications off.' };
    }

    // SMS
    if (!senders.sms) return { status: 'SKIPPED', reason: 'No SMS gateway is set up.' };
    const templateId = senders.smsTemplates[row.event];
    if (!templateId) return { status: 'SKIPPED', reason: `No DLT template is registered for ${row.event}.` };
    const sent = await senders.sms.send({ mobile: row.recipient, templateId, values: rendered.sms });
    return { status: 'SENT', ref: sent.providerRef };
  }
}

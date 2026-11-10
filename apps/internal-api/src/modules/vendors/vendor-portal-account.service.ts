import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { sendConfiguredEmail } from '../auth/resend';

export interface ProvisionResult {
  provisioned: boolean;
  email?: string;
  emailed?: boolean;
  reason?: string;
}

/** What the console shows once: the sign-in, and the password nobody can read back later. */
export interface PortalLoginIssued {
  email: string;
  temporaryPassword: string;
  /** Whether the details were emailed to the transporter (email set up on the server). */
  emailed: boolean;
}

/** The database's refusals (migration 20261110010000), in words for the screen. */
const REFUSAL: Record<string, [number, string]> = {
  PORTAL_LOGIN_BAD_EMAIL: [400, 'That does not look like an email address.'],
  PORTAL_LOGIN_WEAK_PASSWORD: [400, 'The password must be at least 10 characters.'],
  PORTAL_LOGIN_NO_VENDOR: [404, 'That transporter does not exist.'],
  PORTAL_LOGIN_EXISTS: [409, 'This transporter already has a portal login. Reset its password instead.'],
  PORTAL_LOGIN_STAFF_EMAIL: [409, 'That address is a staff sign-in. Give the transporter an address of its own.'],
  PORTAL_LOGIN_EMAIL_TAKEN: [409, 'That address already signs in to Nexraah. Give the transporter an address of its own.'],
  PORTAL_LOGIN_NONE: [409, 'This transporter has no portal login yet. Create one first.'],
};

export function asPortalLoginRefusal(e: unknown): never {
  const code = /PORTAL_LOGIN_[A-Z_]+/.exec((e as Error)?.message ?? '')?.[0];
  if (code && REFUSAL[code]) throw new DomainException(REFUSAL[code][0], code, REFUSAL[code][1]);
  throw e;
}

/** Twelve characters a person can read out on the phone: no 0/O, 1/l/I. */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/**
 * A transporter's portal login — `POST /vendors/:id/activate` step 2-3
 * (docs/api/02-vendors-compliance.md), and the console's create / reset.
 *
 * The account is a Supabase Auth sign-in linked by `vendor_users`. The API
 * holds no service_role key (`config/env.ts` refuses one), so it is made
 * through three narrow definer functions the database owns and only
 * `internal_api` may call (migration 20261110010000) — the same rows
 * `supabase/scripts/provision.mjs` writes. Until then activation only
 * recorded the step as pending, and no transporter on pre-prod could sign in.
 *
 * The password is generated here, shown once to whoever made it, and emailed
 * to the transporter when email is set up. It is never stored readable and
 * never written to the audit trail.
 */
@Injectable()
export class VendorPortalAccountService {
  private readonly logger = new Logger('VendorPortalAccountService');

  constructor(
    @Inject(DB) private readonly db: InternalDb,
    private readonly auditService: AuditService,
  ) {}

  /** The address the transporter signs in with, or null when there is no login yet. */
  async loginEmail(vendorId: string): Promise<string | null> {
    const row = await sql<{ email: string | null }>`select public.portal_login_email(${vendorId}::uuid) as email`.execute(this.db);
    return row.rows[0]?.email ?? null;
  }

  async create(vendorId: string, email: string, actor: AuthenticatedUser): Promise<PortalLoginIssued> {
    const password = temporaryPassword();
    const address = email.trim().toLowerCase();
    await this.db.transaction().execute(async (trx) => {
      await sql`select public.portal_login_create(${vendorId}::uuid, ${address}, ${password})`.execute(trx).catch(asPortalLoginRefusal);
      await this.auditService.record(trx, actor, {
        action: 'PORTAL_LOGIN_CREATED',
        entityType: 'vendors',
        entityId: vendorId,
        after: { email: address },
      });
    });
    return { email: address, temporaryPassword: password, emailed: await this.mailDetails(vendorId, address, password, 'created') };
  }

  async reset(vendorId: string, actor: AuthenticatedUser): Promise<PortalLoginIssued> {
    const password = temporaryPassword();
    let email = '';
    await this.db.transaction().execute(async (trx) => {
      const row = await sql<{ email: string }>`select public.portal_login_reset(${vendorId}::uuid, ${password}) as email`
        .execute(trx)
        .catch(asPortalLoginRefusal);
      email = row.rows[0].email;
      await this.auditService.record(trx, actor, {
        action: 'PORTAL_LOGIN_RESET',
        entityType: 'vendors',
        entityId: vendorId,
        after: { email },
      });
    });
    return { email, temporaryPassword: password, emailed: await this.mailDetails(vendorId, email, password, 'reset') };
  }

  /**
   * On activation: a transporter with an email and no login gets one, and the
   * details by email. Without an email — or if making it fails — the
   * transporter is still active; the console's "Create portal login" is the
   * way in, and the answer says why it was not done here.
   */
  async provision(vendorId: string, actor: AuthenticatedUser): Promise<ProvisionResult> {
    try {
      if (await this.loginEmail(vendorId)) return { provisioned: true, reason: 'ALREADY_HAS_LOGIN' };
      const vendor = await this.db.selectFrom('vendors').select(['email']).where('id', '=', vendorId).executeTakeFirst();
      if (!vendor?.email) return { provisioned: false, reason: 'NO_EMAIL' };
      const issued = await this.create(vendorId, vendor.email, actor);
      return { provisioned: true, email: issued.email, emailed: issued.emailed };
    } catch (e) {
      this.logger.warn(`Portal login for vendor ${vendorId} was not made on activation: ${(e as Error).message}`);
      return { provisioned: false, reason: e instanceof DomainException ? (e.getResponse() as { code: string }).code : 'FAILED' };
    }
  }

  /** The sign-in details, to the transporter. False when email is not set up, or did not go. */
  private async mailDetails(vendorId: string, email: string, password: string, why: 'created' | 'reset'): Promise<boolean> {
    if (!process.env.EMAIL_FROM || !(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY)) return false;
    const portal = (process.env.PORTAL_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
    const vendor = await this.db.selectFrom('vendors').select(['legal_name']).where('id', '=', vendorId).executeTakeFirst();
    const name = vendor?.legal_name ?? 'Transporter';
    const lead = why === 'created' ? 'Your Nexraah transporter portal login is ready.' : 'Your Nexraah transporter portal password has been reset.';
    const lines = [
      `Hello ${name},`,
      '',
      lead,
      portal ? `Sign in at: ${portal}/signin` : 'Sign in on the Nexraah transporter portal.',
      `Email: ${email}`,
      `Password: ${password}`,
      '',
      'Change this password after you sign in (Profile → Change password), and keep it to yourself — Nexraah staff will never ask for it.',
    ];
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    try {
      await sendConfiguredEmail({
        to: email,
        subject: why === 'created' ? 'Your Nexraah transporter portal login' : 'Your Nexraah portal password was reset',
        text: lines.join('\n'),
        html: lines.map((l) => (l ? `<p style="margin:0 0 8px">${escape(l)}</p>` : '')).join(''),
        tag: 'portal-login',
      });
      return true;
    } catch (e) {
      this.logger.warn(`Portal login email to vendor ${vendorId} did not go: ${(e as Error).message}`);
      return false;
    }
  }
}

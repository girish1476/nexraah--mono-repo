import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { DomainException } from '../domain-exception';
import { HMAC_SECRET_CONFIG_KEY, MAX_CLOCK_SKEW_MS } from '../../modules/telematics/telematics.constants';

/**
 * `POST /telematics/ping` — the provider's webhook. HMAC-signed over the raw
 * body with a shared secret in `config`; **no JWT** (docs/api/
 * 10-telematics-import.md). Requires `rawBody: true` on `NestFactory.create`
 * (main.ts) — `req.rawBody` must be the exact bytes the provider signed, not
 * a re-serialization of the parsed body, or a byte-for-byte-faithful but
 * differently-formatted payload would fail verification for no real reason.
 *
 * Signature header: `X-Telematics-Signature`, lowercase hex HMAC-SHA256.
 */
@Injectable()
export class TelematicsHmacGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();

    const signature = request.headers['x-telematics-signature'];
    if (typeof signature !== 'string' || !signature) {
      throw new DomainException(401, 'SIGNATURE_MISSING', 'X-Telematics-Signature header is required.');
    }

    const raw = request.rawBody;
    if (!raw) {
      // Only happens if `rawBody: true` isn't set on the Nest app, or this
      // guard was applied to a route whose body Nest already consumed some
      // other way (e.g. multipart) — a config error, not a caller error.
      throw new DomainException(500, 'RAW_BODY_UNAVAILABLE', 'Server cannot verify this request.');
    }

    const secretRow = await this.db
      .selectFrom('config')
      .select('value')
      .where('key', '=', HMAC_SECRET_CONFIG_KEY)
      .executeTakeFirst();
    const secret = typeof secretRow?.value === 'string' ? secretRow.value : null;
    if (!secret) {
      // Unconfigured, not the caller's fault, but still not a 200 — refuse
      // closed. Never falls back to accepting unsigned pings.
      throw new DomainException(503, 'HMAC_NOT_CONFIGURED', 'Telematics ingest is not configured yet.');
    }

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    if (!constantTimeHexEqual(signature, expected)) {
      throw new DomainException(401, 'SIGNATURE_INVALID', 'Signature does not match.');
    }

    const at = typeof request.body?.at === 'string' ? Date.parse(request.body.at) : NaN;
    if (Number.isNaN(at) || Math.abs(Date.now() - at) > MAX_CLOCK_SKEW_MS) {
      throw new DomainException(401, 'CLOCK_SKEW', 'Ping timestamp is missing or too far from server time.');
    }

    return true;
  }
}

/** Same-length hex strings only — `timingSafeEqual` throws on a length mismatch. */
export function constantTimeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

import type { Request } from 'express';

/**
 * Rate limiting needs a per-account key (part 01-P1 §4: "30/hour per vendor",
 * "10 per 15 min per account") but the edge holds no database and cannot
 * resolve `vendorId` — that happens in `internal-api`, from a verified token
 * (`ADR-02` §4). Decoding the JWT's `sub` here, unverified, is good enough
 * for a rate-limit bucket key: a forged token just earns its own bucket, and
 * every write path is still authenticated for real one hop later. This is
 * never used for authorization, only for counting.
 */
export function identityKey(req: Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (typeof payload.sub === 'string') return `sub:${payload.sub}`;
      } catch {
        // fall through to IP
      }
    }
  }
  return `ip:${req.ip}`;
}

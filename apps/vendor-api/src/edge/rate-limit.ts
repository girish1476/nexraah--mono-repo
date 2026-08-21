import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { identityKey } from './identity';

interface Bucket {
  windowMs: number;
  max: number;
  /** false = log the outlier and let the request through (GET /portal/loads). */
  blocking: boolean;
  match: (req: Request) => boolean;
}

/** part 01-P1 §4. Enforced at this edge because it is where the client IP is real. */
const BUCKETS: Record<string, Bucket> = {
  login: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    blocking: true,
    match: (req) => req.method === 'POST' && /^\/api\/v1\/portal\/auth\/login$/.test(req.path),
  },
  quote: {
    windowMs: 60 * 60 * 1000,
    max: 30,
    blocking: true,
    match: (req) => req.method === 'POST' && /^\/api\/v1\/portal\/loads\/[^/]+\/quote$/.test(req.path),
  },
  upload: {
    windowMs: 60 * 60 * 1000,
    max: 60,
    blocking: true,
    match: (req) =>
      req.method === 'POST' &&
      (/^\/api\/v1\/portal\/trips\/[^/]+\/pod$/.test(req.path) ||
        /^\/api\/v1\/portal\/trips\/[^/]+\/bill$/.test(req.path) ||
        /^\/api\/v1\/portal\/profile\/documents\/[^/]+$/.test(req.path)),
  },
  loads: {
    windowMs: 60 * 60 * 1000,
    max: 120,
    blocking: false,
    match: (req) => req.method === 'GET' && /^\/api\/v1\/portal\/loads$/.test(req.path),
  },
};

/** In-memory fixed window. Single process, ~200 transporter accounts (NFR-05) — no store needed. */
const counters = new Map<string, { windowStart: number; count: number }>();

function hit(bucketKey: string, identity: string, windowMs: number): number {
  const key = `${bucketKey}:${identity}`;
  const now = Date.now();
  const existing = counters.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    counters.set(key, { windowStart: now, count: 1 });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

const logger = new Logger('RateLimit');

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  for (const [name, bucket] of Object.entries(BUCKETS)) {
    if (!bucket.match(req)) continue;

    const identity = identityKey(req);
    const count = hit(name, identity, bucket.windowMs);

    if (count > bucket.max) {
      if (!bucket.blocking) {
        logger.warn(`outlier: ${name} ${identity} — ${count}/${bucket.max} in window`);
        break;
      }
      res.setHeader('Retry-After', Math.ceil(bucket.windowMs / 1000).toString());
      res.status(429).json({
        success: false,
        statusCode: 429,
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
        error: { code: 'RATE_LIMITED', message: `Too many requests. Limit is ${bucket.max} per window.` },
      });
      return;
    }
    break; // a request matches at most one bucket
  }
  next();
}

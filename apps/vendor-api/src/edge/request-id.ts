import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * docs/api/11-portal.md §1.1: generated at the edge if absent, logged by both
 * processes on every line, returned on every response including errors.
 * `internal-api` trusts whatever arrives here — it never generates its own —
 * so this is the one and only place a request id is minted.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}

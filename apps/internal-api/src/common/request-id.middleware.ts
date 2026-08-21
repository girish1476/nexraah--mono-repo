import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithId extends Request {
  requestId: string;
}

/**
 * ADR-02 §7: `vendor-api` generates `X-Request-Id` if absent and forwards it;
 * `internal-api` logs it on every line and returns it on every response,
 * success or error. Internal-only traffic (no upstream proxy) still needs one
 * for the audit trail (`audit_events.request_id`), so this mints its own when
 * the header is missing rather than assuming a proxy always sets it.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    req.requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}

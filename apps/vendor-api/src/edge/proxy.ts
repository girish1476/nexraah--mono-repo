import { Logger } from '@nestjs/common';
import { createProxyMiddleware, type RequestHandler } from 'http-proxy-middleware';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('PortalProxy');

// INTERNAL_API_URL is documented (part 14 §9) as including /api/v1 — the
// proxy target must be origin-only, or node-http-proxy would forward
// req.url (already /api/v1/portal/...) onto a target that also carries
// /api/v1, doubling the prefix.
function originOf(url: string): string {
  return url.replace(/\/api\/v1\/?$/, '');
}

const TARGET = originOf(process.env.INTERNAL_API_URL ?? 'http://localhost:4002/api/v1');
const SERVICE_KEY = process.env.PORTAL_SERVICE_KEY ?? '';

if (!SERVICE_KEY) {
  logger.warn('PORTAL_SERVICE_KEY is not set — every /portal/* call will be rejected by internal-api');
}

interface RetryableRequest extends Request {
  _retried?: boolean;
}

function sendUpstreamTimeout(req: Request, res: Response) {
  if (res.headersSent) return;
  res.status(504).json({
    success: false,
    statusCode: 504,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    error: { code: 'UPSTREAM_TIMEOUT', message: 'internal-api did not respond in time.' },
  });
}

function build(proxyTimeoutMs: number): RequestHandler {
  const proxy: RequestHandler = createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    pathFilter: '/api/v1/portal',
    proxyTimeout: proxyTimeoutMs,
    timeout: proxyTimeoutMs,
    // Multipart streams through as long as no body-parser has consumed the
    // request first — main.ts disables Nest's global body parser for
    // exactly this reason (11-portal.md §1.1, §4).
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('X-Portal-Service', SERVICE_KEY);
        const rid = req.headers['x-request-id'];
        if (rid) proxyReq.setHeader('X-Request-Id', Array.isArray(rid) ? rid[0] : (rid as string));
        // Authorization forwards unmodified by default — no rewrite here.
        // ADR-02 §4: the proxy never asserts identity.
      },
      error: (err, rawReq, rawRes) => {
        const req = rawReq as RetryableRequest;
        const res = rawRes as Response;
        logger.error(`proxy error on ${req.method} ${req.url}: ${err.message}`);

        // 11-portal.md §1.1: GET/HEAD get one retry, 250ms backoff. A write
        // is never retried here — Idempotency-Key exists for that case.
        const retryable = (req.method === 'GET' || req.method === 'HEAD') && !req._retried && !res.headersSent;
        if (retryable) {
          req._retried = true;
          setTimeout(() => proxy(req, res, () => sendUpstreamTimeout(req, res)), 250);
          return;
        }
        sendUpstreamTimeout(req, res);
      },
    },
  });
  return proxy;
}

const multipartProxy = build(30_000);
const defaultProxy = build(10_000);

export function portalProxy(req: Request, res: Response, next: NextFunction) {
  const isMultipart = (req.headers['content-type'] ?? '').startsWith('multipart/form-data');
  (isMultipart ? multipartProxy : defaultProxy)(req, res, next);
}

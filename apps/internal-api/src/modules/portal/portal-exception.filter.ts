import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainException } from '../../common/domain-exception';
import {
  INTERNAL_TO_PORTAL_CODE,
  PORTAL_DETAIL_ALLOWLIST,
  PORTAL_ERROR_MESSAGE,
  PORTAL_ERROR_STATUS,
  portalStatusFor,
} from './portal.errors';

/**
 * `11-portal.md` §2: "Portal handlers **map before throwing** — they do not
 * let an internal service's exception propagate. An unmapped code escaping to
 * `/portal/*` is a `BR-55` finding, not a cosmetic one."
 *
 * Handlers do map (see `portalError()`), but a mapping applied only at the
 * throw site is a mapping one new `await this.someInternalService.x()` away
 * from being skipped. This filter is the backstop, applied to every portal
 * controller, and it fails **closed**: a code it does not recognise becomes
 * `REQUEST_FAILED` with no details, because the code name is itself
 * information (`ADVANCE_BLOCKED` tells a transporter the desk has a
 * document checklist; `SERIES_LOWERED` tells them a numbering series exists).
 *
 * `AllExceptionsFilter`'s envelope is reproduced exactly — controller-scoped
 * filters replace the global one rather than chaining, so `success`,
 * `statusCode`, `path` and `timestamp` have to be written here too or every
 * portal error would arrive in a different shape from every portal success.
 */
@Catch()
export class PortalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PortalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { code, message, details } = this.toPortalError(exception, request);
    const status = portalStatusFor(code);

    if (status >= 500) {
      // The internal detail is logged, never sent. `X-Request-Id` (set by
      // RequestIdMiddleware and echoed on the response) is how support ties
      // the transporter's screenshot to this line.
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      error: details === undefined ? { code, message } : { code, message, details },
    });
  }

  private toPortalError(
    exception: unknown,
    request: Request,
  ): { code: string; message: string; details?: unknown } {
    const raw = this.rawCodeAndMessage(exception, request);
    const mapped = INTERNAL_TO_PORTAL_CODE[raw.code] ?? raw.code;
    const code = mapped in PORTAL_ERROR_STATUS ? mapped : 'REQUEST_FAILED';

    // A message survives only when the code came through unchanged — i.e. a
    // portal handler composed it deliberately. A mapped code gets the portal
    // sentence, because the internal one was written for the console.
    const message =
      code === raw.code && raw.message
        ? raw.message
        : (PORTAL_ERROR_MESSAGE[code] ?? 'We could not complete that.');

    return { code, message, details: this.filterDetails(code, raw.code, raw.details) };
  }

  private filterDetails(code: string, rawCode: string, details: unknown): unknown {
    if (code !== rawCode || details === undefined || details === null) return undefined;
    const allowed = PORTAL_DETAIL_ALLOWLIST[code];
    if (!allowed || typeof details !== 'object' || Array.isArray(details)) return undefined;

    const out: Record<string, unknown> = {};
    for (const key of allowed) {
      const value = (details as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private rawCodeAndMessage(
    exception: unknown,
    request: Request,
  ): { code: string; message?: string; details?: unknown } {
    if (exception instanceof DomainException) {
      const body = exception.getResponse() as { code: string; message: string; details?: unknown };
      return { code: body.code, message: body.message, details: body.details };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Multer's own limit rejection arrives as a 413 PayloadTooLarge before
      // any handler runs — §4 requires 413 FILE_TOO_LARGE, and this is where
      // that shape is met.
      if (status === 413) return { code: 'FILE_TOO_LARGE' };
      if (status === 429) return { code: 'RATE_LIMITED' };
      if (status === 401) return { code: 'UNAUTHORIZED' };
      // 403 from anywhere other than the two provenance guards would confirm
      // that a record exists. §2: "404, never 403, for another vendor's
      // record" — a 403 confirms existence, and vendor A probing an id range
      // learns how many trips vendor B is running.
      if (status === 403 && !this.isProvenanceRefusal(exception)) return { code: 'NOT_FOUND' };
      if (status === 404) return { code: 'NOT_FOUND' };

      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const raw = (body as { message: unknown }).message;
        if (Array.isArray(raw)) {
          return {
            code: 'VALIDATION_ERROR',
            message: String(raw[0] ?? 'The request could not be accepted as sent.'),
            details: raw.length > 1 ? { messages: raw } : undefined,
          };
        }
      }
      return { code: status >= 500 ? 'REQUEST_FAILED' : 'VALIDATION_ERROR' };
    }

    // Anything unhandled: a pg error is the important case here. A grant
    // violation (`permission denied for table indents`) carries the column
    // name that proves the redaction worked, and must not be echoed —
    // reaching this branch at all is a bug in the query, logged above.
    void request;
    return { code: 'REQUEST_FAILED' };
  }

  private isProvenanceRefusal(exception: HttpException): boolean {
    const body = exception.getResponse();
    const code = typeof body === 'object' && body !== null ? (body as { code?: string }).code : undefined;
    return code === 'SERVICE_KEY_REQUIRED' || code === 'WRONG_AUDIENCE' || code === 'VENDOR_SUSPENDED';
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainException } from '../domain-exception';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Produces the envelope `docs/api/00-conventions.md` §3 documents:
 * `{ success: false, statusCode, path, timestamp, error: { code, message, details? } }`.
 * The frontend branches on `error.code` by name (`ADVANCE_BLOCKED`,
 * `PERMISSION_FIXED`, …) — an endpoint that throws a bare `HttpException`
 * still gets a well-formed envelope here, just with the generic `ERROR` code,
 * so `ApiException` is what to reach for whenever a caller needs to branch.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const error = this.resolveError(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${error.code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      error,
    });
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveError(exception: unknown): ErrorBody {
    if (exception instanceof DomainException) {
      const body = exception.getResponse() as { code: string; message: string; details?: unknown };
      return { code: body.code, message: body.message, details: body.details };
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      // ValidationPipe (class-validator) throws BadRequestException with
      // `{ statusCode, message: string[], error: 'Bad Request' }` — an array
      // is the actual signal for that shape. Every other built-in Nest
      // exception (UnauthorizedException, ForbiddenException, NotFoundException,
      // a hand-thrown BadRequestException('single string'), …) has the same
      // `{ message: string }` field but is not a validation error, so it must
      // not be tagged `VALIDATION_ERROR` just for having a `message` key.
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const raw = (body as { message: unknown; error?: unknown }).message;
        if (Array.isArray(raw)) {
          return {
            code: 'VALIDATION_ERROR',
            message: raw[0] ?? exception.message,
            details: raw.length > 1 ? { messages: raw } : undefined,
          };
        }
        return { code: this.codeForStatus(exception.getStatus()), message: String(raw) };
      }
      return { code: this.codeForStatus(exception.getStatus()), message: String(body) };
    }

    return { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      default:
        return 'ERROR';
    }
  }
}

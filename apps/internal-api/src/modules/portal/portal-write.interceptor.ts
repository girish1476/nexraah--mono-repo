import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PortalWriteResult } from './portal.types';

/**
 * `11-portal.md` §3: "a repeat with the same key returns the original row and
 * `200`". Every portal write returns a `PortalWriteResult`; this unwraps it and
 * decides the status.
 *
 * | | fresh | replay |
 * |---|---|---|
 * | `POST /portal/loads/:code/quote` | 201 | 200 |
 * | `DELETE /portal/quotes/:id` | 204 | 200 |
 * | `POST /portal/fleet` | 201 | 200 |
 * | `PATCH /portal/fleet/:id` | 200 | 200 |
 *
 * The fresh status is the handler's own (`@HttpCode`, or Nest's default for the
 * verb); only the replay is forced, and it is forced to `200` for every one of
 * the four — including the `204` withdraw, because a replay has a body (the
 * already-withdrawn quote) and `204` may not carry one.
 *
 * Controller-scoped, so it runs INSIDE the global `TransformInterceptor`: this
 * one strips the wrapper, that one puts the `{ success, data }` envelope round
 * what is left. Reversing the order would envelope the wrapper.
 */
@Injectable()
export class PortalWriteInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) => {
        if (!(result instanceof PortalWriteResult)) return result;
        if (result.replayed) {
          context.switchToHttp().getResponse<Response>().status(200);
        }
        return result.payload;
      }),
    );
  }
}

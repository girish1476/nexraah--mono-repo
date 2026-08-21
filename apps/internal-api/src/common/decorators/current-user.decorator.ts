import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/** `@CurrentUser() user: AuthenticatedUser` — set by `SupabaseJwtGuard`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // SupabaseJwtGuard runs first in every guard chain that uses this
    // decorator and throws before the handler is reached if `user` is unset.
    return request.user as AuthenticatedUser;
  },
);

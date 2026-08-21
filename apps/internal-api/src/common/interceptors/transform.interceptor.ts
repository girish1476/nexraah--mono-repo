import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApprovalRequiredResponse } from '../approval-required.response';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/** `docs/api/00-conventions.md` §2 envelope, plus the §7 `202` special case. */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof ApprovalRequiredResponse) {
          context.switchToHttp().getResponse<Response>().status(202);
          return { success: true, data: { approvalRequired: true, approval: data.approval } as T };
        }
        return { success: true, data };
      }),
    );
  }
}

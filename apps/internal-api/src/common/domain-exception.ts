import { HttpException } from '@nestjs/common';

/**
 * The one exception type every service throws for a business-rule refusal.
 * `AllExceptionsFilter` unwraps it into the `error: { code, message, details }`
 * object 00-conventions.md §3 requires — `code` is what the frontend branches
 * on, `details.unmet` is what blocked panels render (§6).
 */
export class DomainException extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export interface UnmetItem {
  key: string;
  label: string;
  state: 'MISSING' | 'UNVERIFIED' | 'REJECTED' | 'BLOCKED';
}

/** REASON_TOO_SHORT — every mandatory-reason field in this system shares the ≥20-char rule. */
export function assertReason(reason: string | null | undefined): asserts reason is string {
  if (!reason || reason.trim().length < 20) {
    throw new DomainException(
      400,
      'REASON_TOO_SHORT',
      'The reason must be at least 20 characters.',
    );
  }
}

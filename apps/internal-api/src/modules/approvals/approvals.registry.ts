import { Injectable } from '@nestjs/common';
import type { ApprovalHandler, ApprovalKind } from './approvals.types';

/**
 * Keyed by `kind:entityType`, not `kind` alone. `BR-57` has two owners —
 * `ADVANCE_POLICY_CHANGE` is raised both by `vendors.service.ts` (the
 * vendor's own standing policy) and `indents.service.ts` (one load's
 * departure from it) — same kind, unrelated replay actions. A single
 * `kind`-keyed map means the second `register()` silently overwrites the
 * first with no error, which is exactly the kind of bug that only shows up
 * in production when the wrong action replays. `entityType` is already
 * carried on every approval row (`raise()`'s `entityType`/`entityId`), so it
 * costs nothing to key on.
 *
 * The owning wave's module calls `register()` in its constructor (or a
 * lifecycle hook) once it exists. Nothing registers most kinds yet — every
 * kind is defined and raisable, but `approve()` on an unregistered
 * `kind:entityType` pair fails closed with a clear error until the owning
 * wave is built. That is the honest state of a partial build, not a bug to
 * paper over with a stub that pretends success.
 */
@Injectable()
export class ApprovalsRegistry {
  private readonly handlers = new Map<string, ApprovalHandler>();

  register(kind: ApprovalKind, entityType: string, handler: ApprovalHandler): void {
    const key = this.key(kind, entityType);
    if (this.handlers.has(key)) {
      // Fail loud at boot, not silently at the first mismatched replay.
      throw new Error(`ApprovalsRegistry: a handler for ${key} is already registered.`);
    }
    this.handlers.set(key, handler);
  }

  get(kind: ApprovalKind, entityType: string): ApprovalHandler | undefined {
    return this.handlers.get(this.key(kind, entityType));
  }

  private key(kind: ApprovalKind, entityType: string): string {
    return `${kind}:${entityType}`;
  }
}

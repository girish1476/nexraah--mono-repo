import { DomainException } from '../domain-exception';
import type { AuthenticatedUser, PermissionLevel } from '../interfaces/authenticated-user.interface';

const LEVEL_RANK: Record<PermissionLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2 };

/**
 * "Any one of these" — the check `@RequirePermission` cannot express.
 *
 * Part 01 §2.5 makes the decorator a single flat code, which is right for a
 * gate one desk owns (`payment.release`). A few writes are legitimately done
 * by more than one desk — a charge is captured by whoever is reading the
 * document, which is Compliance on advance papers, the POD desk on delivery
 * papers, or Ops on a trip they run — and `PnlService` already answers the
 * same problem inline for `pnl.view_all | pnl.view_own`. This is that check,
 * named, so the next route with the same shape does not go out with no
 * server-side check at all (which is how `POST /trips/:id/charges` shipped).
 *
 * Same error shape as `PermissionsGuard`, so the portal's error copy needs
 * nothing new.
 */
export function assertAnyPermission(
  user: AuthenticatedUser,
  codes: readonly string[],
  level: PermissionLevel = 'EDIT',
): void {
  const held = codes.some((code) => LEVEL_RANK[user.permissions.get(code) ?? 'NONE'] >= LEVEL_RANK[level]);
  if (!held) {
    throw new DomainException(403, 'PERMISSION_DENIED', `Missing permission: ${codes.join(' or ')}.`);
  }
}

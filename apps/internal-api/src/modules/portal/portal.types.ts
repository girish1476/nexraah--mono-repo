/**
 * The transporter principal, resolved by `PortalVendorGuard` from the JWT
 * subject against `vendor_users` (`ADR-02` §4). No header names the vendor
 * and none ever will — `internal-api` would ignore an `X-Vendor-Id` if
 * `vendor-api` ever grew one.
 */
export interface PortalVendor {
  vendorId: string;
  authUserId: string;
  code: string;
  legalName: string;
  /** `ACTIVE` or `SUSPENDED`. Drives the suspension banner (`11-portal.md` §5.1). */
  status: string;
  permissions: readonly string[];
}

declare module 'express' {
  interface Request {
    portalVendor?: PortalVendor;
  }
}

/**
 * What a portal write hands back to its controller. `11-portal.md` §3: a
 * repeat with the same idempotency key returns the ORIGINAL row and `200` —
 * not a duplicate and not an error. `PortalWriteInterceptor` unwraps this and
 * sets the status; nothing downstream ever sees the wrapper.
 */
export class PortalWriteResult<T> {
  constructor(
    public readonly payload: T,
    public readonly replayed: boolean,
  ) {}
}

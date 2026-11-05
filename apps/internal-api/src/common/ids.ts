/**
 * Whether a reference can be an id (a uuid) at all.
 *
 * Several lookups take "whatever the caller has" — an id or a load number —
 * and try each in turn. PostgreSQL refuses a non-uuid compared with a uuid
 * column outright (22P02), so trying the id lookup first with "4472" failed the
 * whole request before the number was ever tried: every "View order" link built
 * from a load number opened on "A value is in the wrong format" on a real
 * database. Ask this first and skip the id lookups when it says no.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && UUID.test(ref);
}

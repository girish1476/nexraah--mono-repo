import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, PortalDb } from '../../db/kysely';
import { portalError } from './portal.errors';
import { expose } from './portal.dto';
import { PortalWriteResult } from './portal.types';

/**
 * `11-portal.md` §3 — the replay ledger every portal write goes through.
 * `supabase/migrations/20260824090000_c_portal_idempotency.sql`.
 *
 * > Scope: `(vendor_id, endpoint, idempotency_key)`, unique-constrained. Never
 * > a global key space — one vendor must not be able to probe another's keys.
 *
 * `vendor_id` leads the key for that reason, and it is also the reason a lookup
 * that misses is indistinguishable from one belonging to another vendor: the
 * predicate names the caller's own id, so a foreign key is simply not there.
 *
 * `vendor_api` holds `select, insert` on this table and nothing else — a stored
 * response is never rewritten, so a replay cannot be made to return something
 * the first call did not.
 */
@Injectable()
export class PortalIdempotencyRepository {
  constructor(@Inject(DB) private readonly db: PortalDb) {}

  transaction() {
    return this.db.transaction();
  }

  /**
   * The stored response for a previous identical attempt, or `undefined`.
   *
   * Runs OUTSIDE the write transaction, before any work is done: the point of
   * the ledger is that a retry from a phone on a dying signal costs one SELECT,
   * not a second quote.
   */
  async findResponse(
    vendorId: string,
    endpoint: string,
    key: string,
  ): Promise<unknown | undefined> {
    const row = await this.db
      .selectFrom('portal_idempotency_keys')
      .select('response')
      .where('vendor_id', '=', vendorId)
      .where('endpoint', '=', endpoint)
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    return row?.response;
  }

  /**
   * Records the response inside the caller's transaction, as its last
   * statement, so the ledger row and the domain row commit together — an
   * interrupted write leaves neither.
   *
   * The pre-flight `findResponse` catches a SEQUENTIAL retry, which is the
   * common case: signal dies, transporter taps again a few seconds later. It
   * cannot catch two taps in flight AT ONCE — both read an empty ledger. That
   * race is settled here, by the unique constraint: the loser inserts nothing,
   * and `PortalIdempotencyRaceError` rolls its whole transaction back so that
   * `runIdempotentWrite` can replay the winner's response instead of returning
   * a second quote.
   */
  async record(
    db: DbExecutor,
    vendorId: string,
    endpoint: string,
    key: string,
    response: unknown,
  ): Promise<void> {
    const result = await db
      .insertInto('portal_idempotency_keys')
      .values({
        vendor_id: vendorId,
        endpoint,
        idempotency_key: key,
        response: response as never,
      })
      .onConflict((oc) => oc.columns(['vendor_id', 'endpoint', 'idempotency_key']).doNothing())
      .executeTakeFirst();

    if ((result?.numInsertedOrUpdatedRows ?? 0n) === 0n) {
      throw new PortalIdempotencyRaceError();
    }
  }
}

/**
 * Internal sentinel, never reaches the wire. `PortalExceptionFilter` would turn
 * it into `REQUEST_FAILED` if it ever escaped, which is the right failure for a
 * bug in this file.
 */
export class PortalIdempotencyRaceError extends Error {}

export interface IdempotentWriteContext<T> {
  idempotency: PortalIdempotencyRepository;
  vendorId: string;
  endpoint: string;
  key: string;
  dto: new () => T;
}

/**
 * The pre-flight half of `runIdempotentWrite`, split out for a handler whose
 * fresh-request path does real work — a file upload to object storage, most
 * often — BEFORE the write transaction that `runIdempotentWrite` wraps.
 *
 * `portal-idempotency.repository.ts`'s own contract is that a replay costs
 * one `SELECT`, before any work is done: a handler with a pre-transaction
 * step must call this FIRST and return its result immediately if it is
 * defined, so a retried request never re-uploads bytes it already stored the
 * first time. Only when this returns `undefined` should the caller proceed —
 * to storage, then to `runIdempotentWrite` for the transactional write.
 *
 * The replay is re-`expose()`d rather than returned raw: the stored jsonb was
 * allow-listed when it was written, and running it through the DTO again means
 * a field added to the class later cannot smuggle a stale value out of an old
 * row, nor a removed field survive in one.
 */
export async function checkIdempotentReplay<T>(
  ctx: IdempotentWriteContext<T>,
): Promise<PortalWriteResult<T> | undefined> {
  const replay = await ctx.idempotency.findResponse(ctx.vendorId, ctx.endpoint, ctx.key);
  return replay ? new PortalWriteResult(expose(ctx.dto, replay), true) : undefined;
}

/**
 * The `11-portal.md` §3 envelope every portal write runs inside:
 *
 * 1. a stored response for `(vendor, endpoint, key)` replays immediately,
 *    `200`, no work done;
 * 2. otherwise `work()` runs — it must call `record()` as the last statement of
 *    its transaction;
 * 3. if `work()` lost the insert race, its transaction has rolled back and the
 *    winner's response is replayed instead.
 *
 * A handler that has to do pre-transaction work of its own (a storage upload)
 * should call `checkIdempotentReplay` itself before that work, rather than
 * rely on step 1 here — by the time this runs, that work has already happened.
 * This still repeats the same cheap `SELECT`, which is harmless; it exists so
 * every call to `runIdempotentWrite` keeps the guarantee its own doc comment
 * describes, whether or not the caller also pre-checked.
 */
export async function runIdempotentWrite<T>(
  ctx: IdempotentWriteContext<T>,
  work: () => Promise<PortalWriteResult<T>>,
): Promise<PortalWriteResult<T>> {
  const replay = await checkIdempotentReplay(ctx);
  if (replay) return replay;

  try {
    return await work();
  } catch (error) {
    if (!(error instanceof PortalIdempotencyRaceError)) throw error;

    const stored = await ctx.idempotency.findResponse(ctx.vendorId, ctx.endpoint, ctx.key);
    // The winner committed between our two reads or it did not; if it somehow
    // did not, this is a bug and gets the dull 500 rather than a second write.
    if (stored === undefined) throw portalError('REQUEST_FAILED');
    return new PortalWriteResult(expose(ctx.dto, stored), true);
  }
}

/**
 * `11-portal.md` §3: "Missing key on a write → `400 IDEMPOTENCY_KEY_REQUIRED`."
 * Checked in the controller, before the body is looked at, so a retry that lost
 * its header fails the same way whatever else is wrong with it.
 */
export function assertIdempotencyKey(key: string | undefined): asserts key is string {
  if (!key || !key.trim()) throw portalError('IDEMPOTENCY_KEY_REQUIRED');
}

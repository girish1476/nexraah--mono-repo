import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { RoutePointsService } from './route-points.service';

export interface ShareState {
  /** Null until a link has been created for this trip. */
  token: string | null;
  /** True while the link answers: created, not switched off, truck not yet unloaded. */
  active: boolean;
  /** Why it is not active, when it is not. */
  endedBecause: 'UNLOADED' | 'STOPPED' | null;
}

/**
 * A shareable live-tracking link for a trip.
 *
 * Operations sends it to a client or to the truck's owner by WhatsApp or SMS.
 * Whoever holds the token sees one trip's route, milestones and positions —
 * and nothing that would break the wall between the two sides: no client, no
 * transporter, no rates, no internal notes, no staff names. That is why the
 * public view below builds its own answer instead of reusing the internal
 * tracking sheet.
 *
 * The link lives as long as the journey. It stops answering the moment the
 * truck is unloaded, or earlier if someone switches it off.
 */
@Injectable()
export class TrackingLinksService {
  constructor(
    @Inject(DB) private readonly db: InternalDb,
    private readonly auditService: AuditService,
    private readonly routePointsService: RoutePointsService,
  ) {}

  private async trip(tripId: string) {
    const trip = await this.db
      .selectFrom('trips')
      .select(['id', 'vehicle_no', 'delivered_at'])
      .where('id', '=', tripId)
      .executeTakeFirst();
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
    return trip;
  }

  private liveLink(tripId: string) {
    return this.db
      .selectFrom('trip_tracking_links')
      .select(['id', 'token'])
      .where('trip_id', '=', tripId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
  }

  async state(tripId: string): Promise<ShareState> {
    const trip = await this.trip(tripId);
    const link = await this.liveLink(tripId);
    if (!link) return { token: null, active: false, endedBecause: null };
    return trip.delivered_at
      ? { token: link.token, active: false, endedBecause: 'UNLOADED' }
      : { token: link.token, active: true, endedBecause: null };
  }

  /** Creates the trip's link, or returns the one it already has. */
  async create(tripId: string, actor: AuthenticatedUser): Promise<ShareState> {
    const trip = await this.trip(tripId);
    if (!trip.vehicle_no) {
      throw new DomainException(409, 'NOT_PLACED', 'Allocate the vehicle first — there is nothing to track yet.');
    }
    if (trip.delivered_at) {
      throw new DomainException(409, 'TRACKING_CLOSED', 'This truck has been unloaded; tracking has ended.');
    }
    const existing = await this.liveLink(tripId);
    if (existing) return { token: existing.token, active: true, endedBecause: null };

    // 144 bits, URL-safe: long enough that a link cannot be guessed.
    const token = randomBytes(18).toString('base64url');
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('trip_tracking_links').values({ trip_id: tripId, token, created_by: actor.userId }).execute();
      await this.auditService.record(trx, actor, {
        action: 'TRACKING_LINK_CREATED',
        entityType: 'trips',
        entityId: tripId,
      });
    });
    return { token, active: true, endedBecause: null };
  }

  /** Switches the link off. Anyone still holding it is told tracking has ended. */
  async stop(tripId: string, actor: AuthenticatedUser): Promise<ShareState> {
    await this.trip(tripId);
    const link = await this.liveLink(tripId);
    if (!link) return { token: null, active: false, endedBecause: null };
    await this.db.transaction().execute(async (trx) => {
      const now = new Date().toISOString();
      await trx.updateTable('trip_tracking_links').set({ revoked_at: now, updated_at: now }).where('id', '=', link.id).execute();
      await this.auditService.record(trx, actor, {
        action: 'TRACKING_LINK_STOPPED',
        entityType: 'trips',
        entityId: tripId,
      });
    });
    return { token: null, active: false, endedBecause: 'STOPPED' };
  }

  /**
   * What the holder of a link sees. No authentication — the token is the key.
   *
   * A dead link answers `410` with nothing about the trip, so a link that has
   * ended cannot be used to learn where a truck went afterwards.
   */
  async publicView(token: string) {
    const link = await this.db
      .selectFrom('trip_tracking_links')
      .innerJoin('trips', 'trips.id', 'trip_tracking_links.trip_id')
      .select([
        'trips.id as tripId',
        'trips.vehicle_no as vehicleNo',
        'trips.lane as lane',
        'trips.stage as stage',
        'trips.reached_loading_at as reachedLoadingAt',
        'trips.loading_completed_at as loadedAt',
        'trips.departed_at as departedAt',
        'trips.reached_destination_at as reachedDestinationAt',
        'trips.delivered_at as deliveredAt',
        'trip_tracking_links.revoked_at as revokedAt',
      ])
      .where('trip_tracking_links.token', '=', token)
      .executeTakeFirst();
    if (!link) throw new DomainException(404, 'TRACKING_LINK_UNKNOWN', 'This tracking link is not valid.');
    if (link.revokedAt) throw new DomainException(410, 'TRACKING_LINK_ENDED', 'This tracking link has been switched off.');
    if (link.deliveredAt) {
      throw new DomainException(410, 'TRACKING_LINK_ENDED', 'The truck has been unloaded, so this tracking link has ended.');
    }

    const updates = await this.db
      .selectFrom('trip_tracking_updates')
      .select(['id', 'kind', 'location', 'lat', 'lng', 'status', 'recorded_at as recordedAt'])
      .where('trip_id', '=', link.tripId)
      .orderBy('recorded_at', 'asc')
      .execute();

    // The exact gates, when they are on file for this client and route — the
    // client knows its own sites and the owner's driver is going to them.
    const points = await this.routePointsService.get(link.tripId);
    const [fromCity, toCity] = (link.lane ?? '').split('→').map((x) => x.trim());
    return {
      vehicleNo: link.vehicleNo || null,
      fromCity: fromCity || null,
      toCity: toCity || null,
      stage: link.stage,
      reachedLoadingAt: link.reachedLoadingAt ?? null,
      loadedAt: link.loadedAt ?? null,
      departedAt: link.departedAt ?? null,
      reachedDestinationAt: link.reachedDestinationAt ?? null,
      loading: points.loading,
      unloading: points.unloading,
      // Deliberately without `note` and without who recorded it — those are the desk's own.
      updates: updates.map((u) => ({
        id: u.id,
        kind: u.kind,
        location: u.location,
        lat: u.lat === null ? null : Number(u.lat),
        lng: u.lng === null ? null : Number(u.lng),
        status: u.status ?? null,
        recordedAt: u.recordedAt,
      })),
    };
  }
}

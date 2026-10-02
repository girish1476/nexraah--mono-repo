import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';

/** One end of the route: the address a driver is sent to, and its pin on the map if known. */
export class RoutePointDto {
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}

/** `PUT /trips/:id/route-points` — either end, or both. An end left out is left as it is. */
export class SaveRoutePointsDto {
  @IsOptional() @ValidateNested() @Type(() => RoutePointDto) loading?: RoutePointDto;
  @IsOptional() @ValidateNested() @Type(() => RoutePointDto) unloading?: RoutePointDto;
}

export interface RoutePoint {
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RoutePoints {
  fromCity: string;
  toCity: string;
  loading: RoutePoint;
  unloading: RoutePoint;
  /** True when these were already on file for this client and route before this trip — i.e. reused. */
  onFile: boolean;
}

const EMPTY: RoutePoint = { address: null, lat: null, lng: null };
const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * The exact loading and unloading points of a trip's route.
 *
 * They are kept per **client and route**, not per trip: captured on one trip,
 * they are already there for the next vehicle placed for the same client on
 * the same route — which is the point. A trip reads them through its indent.
 */
@Injectable()
export class RoutePointsService {
  constructor(
    @Inject(DB) private readonly db: InternalDb,
    private readonly auditService: AuditService,
  ) {}

  private async route(tripId: string) {
    const row = await this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .select(['indents.client_id as clientId', 'indents.from_city as fromCity', 'indents.to_city as toCity'])
      .where('trips.id', '=', tripId)
      .executeTakeFirst();
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
    return row;
  }

  private find(clientId: string, fromCity: string, toCity: string) {
    return this.db
      .selectFrom('client_route_points')
      .selectAll()
      .where('client_id', '=', clientId)
      .where((eb) => eb(eb.fn<string>('lower', [eb.ref('from_city')]), '=', fromCity.toLowerCase()))
      .where((eb) => eb(eb.fn<string>('lower', [eb.ref('to_city')]), '=', toCity.toLowerCase()))
      .executeTakeFirst();
  }

  async get(tripId: string): Promise<RoutePoints> {
    const route = await this.route(tripId);
    const row = await this.find(route.clientId, route.fromCity, route.toCity);
    return {
      fromCity: route.fromCity,
      toCity: route.toCity,
      loading: row ? { address: row.loading_address, lat: num(row.loading_lat), lng: num(row.loading_lng) } : EMPTY,
      unloading: row ? { address: row.unloading_address, lat: num(row.unloading_lat), lng: num(row.unloading_lng) } : EMPTY,
      onFile: !!row,
    };
  }

  async save(tripId: string, dto: SaveRoutePointsDto, actor: AuthenticatedUser): Promise<RoutePoints> {
    for (const [name, point] of [['loading', dto.loading], ['unloading', dto.unloading]] as const) {
      if (point && (point.lat === undefined) !== (point.lng === undefined)) {
        throw new DomainException(400, 'VALIDATION_ERROR', `Give both latitude and longitude for the ${name} point, or neither.`);
      }
    }
    const route = await this.route(tripId);
    const existing = await this.find(route.clientId, route.fromCity, route.toCity);

    const coord = (v: number | undefined) => (v === undefined ? null : String(v));
    // An end that was not sent is left exactly as it is on file.
    const patch: {
      loading_address?: string | null;
      loading_lat?: string | null;
      loading_lng?: string | null;
      unloading_address?: string | null;
      unloading_lat?: string | null;
      unloading_lng?: string | null;
    } = {};
    if (dto.loading) {
      patch.loading_address = dto.loading.address?.trim() || null;
      patch.loading_lat = coord(dto.loading.lat);
      patch.loading_lng = coord(dto.loading.lng);
    }
    if (dto.unloading) {
      patch.unloading_address = dto.unloading.address?.trim() || null;
      patch.unloading_lat = coord(dto.unloading.lat);
      patch.unloading_lng = coord(dto.unloading.lng);
    }

    await this.db.transaction().execute(async (trx) => {
      if (existing) {
        await trx
          .updateTable('client_route_points')
          .set({ ...patch, updated_by: actor.userId, updated_at: new Date().toISOString() })
          .where('id', '=', existing.id)
          .execute();
      } else {
        await trx
          .insertInto('client_route_points')
          .values({
            client_id: route.clientId,
            from_city: route.fromCity,
            to_city: route.toCity,
            ...patch,
            updated_by: actor.userId,
          })
          .execute();
      }
      await this.auditService.record(trx, actor, {
        action: 'ROUTE_POINTS_SAVED',
        entityType: 'trips',
        entityId: tripId,
        after: { clientId: route.clientId, fromCity: route.fromCity, toCity: route.toCity, ...dto },
      });
    });
    return this.get(tripId);
  }
}

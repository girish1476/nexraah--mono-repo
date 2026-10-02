import { request } from '@/apis';
import type { RoutePoint } from '@/lib/route-map';
import type { TrackingKind, TrackingStatus, TripStage } from './types';

/* ---- the shareable tracking link ----------------------------------------- */

export interface ShareState {
  /** Null until a link has been created for this trip. */
  token: string | null;
  /** True while the link answers: created, not switched off, truck not yet unloaded. */
  active: boolean;
  endedBecause: 'UNLOADED' | 'STOPPED' | null;
}

/** GET /trips/:id/tracking/share — whether this trip is being shared, and its link. */
export function getShare(tripId: string) {
  return request<ShareState>({ url: `/trips/${tripId}/tracking/share`, method: 'GET' });
}

/** POST /trips/:id/tracking/share · `indent.manage` — creates the link, or returns the one it has. */
export function createShare(tripId: string) {
  return request<ShareState>({ url: `/trips/${tripId}/tracking/share`, method: 'POST' });
}

/** DELETE /trips/:id/tracking/share · `indent.manage` — switches the link off. */
export function stopShare(tripId: string) {
  return request<ShareState>({ url: `/trips/${tripId}/tracking/share`, method: 'DELETE' });
}

/**
 * What the holder of a tracking link sees — `GET /public/tracking/:token`, no
 * sign-in. Deliberately thin: no client, no transporter, no rates, no notes.
 * `410 TRACKING_LINK_ENDED` once the truck is unloaded or the link switched off.
 */
export interface PublicTracking {
  vehicleNo: string | null;
  fromCity: string | null;
  toCity: string | null;
  stage: TripStage;
  reachedLoadingAt: string | null;
  loadedAt: string | null;
  departedAt: string | null;
  reachedDestinationAt: string | null;
  loading: RoutePoint;
  unloading: RoutePoint;
  updates: {
    id: string;
    kind: TrackingKind;
    location: string;
    lat: number | null;
    lng: number | null;
    status: TrackingStatus | null;
    recordedAt: string;
  }[];
}

export function getPublicTracking(token: string) {
  return request<PublicTracking>({ url: `/public/tracking/${encodeURIComponent(token)}`, method: 'GET' });
}

/* ---- the exact loading and unloading points ------------------------------ */

export interface RoutePoints {
  fromCity: string;
  toCity: string;
  loading: RoutePoint;
  unloading: RoutePoint;
  /** Already on file for this client and route — carried over from an earlier trip. */
  onFile: boolean;
}

/** GET /trips/:id/route-points — kept per client and route, so a repeat trip arrives with them filled in. */
export function getRoutePoints(tripId: string) {
  return request<RoutePoints>({ url: `/trips/${tripId}/route-points`, method: 'GET' });
}

/** PUT /trips/:id/route-points · `indent.manage` — either end, or both. */
export function saveRoutePoints(
  tripId: string,
  body: Partial<Record<'loading' | 'unloading', { address?: string; lat?: number; lng?: number }>>,
) {
  return request<RoutePoints>({ url: `/trips/${tripId}/route-points`, method: 'PUT', data: body });
}

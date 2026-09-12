import { DomainException } from '../../common/domain-exception';

/**
 * The one parse-and-range-check for an uploaded photo's coordinates, shared
 * by the console upload (`attachments.service.ts`) and the transporter
 * portal's (`portal-profile.service.ts`) — the geotag was lost on both paths
 * because each handled it separately and neither finished the job.
 *
 * Multipart text parts arrive as strings; the DTOs have already checked the
 * *shape* (a signed decimal), so what is left is meaning: a latitude beyond
 * ±90 or longitude beyond ±180 is not a place on Earth. Absent (either half)
 * means "no geotag" — whether that is acceptable is the caller's rule, since
 * only the selfie requires one.
 */
export function parseGeo(
  latitude?: string | null,
  longitude?: string | null,
): { lat: number; lng: number } | null {
  if (latitude == null || longitude == null || latitude === '' || longitude === '') return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new DomainException(400, 'VALIDATION_ERROR', 'The photo location is not a valid coordinate.');
  }
  return { lat, lng };
}

/**
 * Google Maps for a trip's route, and the links that send a location or a
 * tracking page to someone's phone. Pure functions — shared by the order's
 * Tracking tab and the public tracking page.
 */

/** One end of a route: the address a driver is sent to, and its pin if known. */
export interface RoutePoint {
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * A typed place name, made unambiguous for Google.
 *
 * A bare word is a *search*, not a place: "Thanjavur" on its own found a
 * filter-coffee shop of that name instead of the town. Naming the country
 * makes Google read it as a location — "Thanjavur, India" is the city.
 * Coordinates, and text that already names India, are left as they are.
 */
export function placeText(text: string | null | undefined): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return 'India';
  if (/^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(t)) return t.replace(/\s+/g, '');
  return /\bindia\b/i.test(t) ? t : `${t}, India`;
}

/** What Google should search for: the exact pin, else the address, else the city. */
export function placeQuery(point: RoutePoint | null | undefined, city: string | null): string {
  if (point && point.lat !== null && point.lng !== null) return `${point.lat},${point.lng}`;
  return placeText(point?.address?.trim() || city);
}

/**
 * The embedded map: the driving route from the loading point to the unloading
 * point, through the truck's last known position when there is one.
 *
 * With `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set it uses the Maps Embed API;
 * without one, Google's plain embed — same route, no key.
 */
export function routeMapSrc(origin: string, destination: string, via?: string | null): string {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const o = encodeURIComponent(origin);
  const d = encodeURIComponent(destination);
  if (key) {
    const w = via ? `&waypoints=${encodeURIComponent(via)}` : '';
    return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${o}&destination=${d}${w}`;
  }
  // The classic embed chains stops with "+to:".
  const daddr = via ? `${encodeURIComponent(via)}+to:${d}` : d;
  return `https://maps.google.com/maps?saddr=${o}&daddr=${daddr}&output=embed`;
}

/** The same route, opened in Google Maps itself. */
export function routeMapLink(origin: string, destination: string, via?: string | null): string {
  const w = via ? `&waypoints=${encodeURIComponent(via)}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${w}`;
}

/** A link that opens one place in Google Maps — what gets sent to a driver. */
export function placeLink(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Reads coordinates out of whatever was pasted: a Google Maps link
 * (`…/@17.6868,83.2185,15z`, `?q=17.68,83.21`, `!3d17.68!4d83.21`) or a plain
 * `17.6868, 83.2185`. Null when there are none in it — a shortened
 * `maps.app.goo.gl` link carries no coordinates and has to be opened first.
 */
export function coordsFrom(text: string): { lat: number; lng: number } | null {
  const patterns = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination|daddr)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Digits only, with India's country code put on a bare ten-digit mobile. Empty when nothing usable was typed. */
export function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 11 ? digits : '';
}

/** Opens WhatsApp with the message ready. With no number it asks who to send it to. */
export function whatsappLink(message: string, phone = ''): string {
  const to = phoneDigits(phone);
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/** Opens the phone's own messages app with the text ready. */
export function smsLink(message: string, phone = ''): string {
  const to = phoneDigits(phone);
  return `sms:${to ? `+${to}` : ''}?&body=${encodeURIComponent(message)}`;
}

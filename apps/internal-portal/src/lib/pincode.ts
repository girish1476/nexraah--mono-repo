import { useEffect, useState } from 'react';
import { integrationSwitches } from './integration-switches';

/**
 * A 6-digit PIN code → its state, district and post office areas, from India
 * Post through the free postalpincode.in service (no key, CORS-open). Control
 * → Integrations → PIN code lookup switches it.
 *
 * Advisory, like the IFSC lookup: it fills what is blank and shows the areas
 * to check the address against; a failure never blocks a form.
 */

export interface PincodeArea {
  state: string;
  district: string;
  /** Post office names, e.g. "Atchutapuram". */
  places: string[];
}

/** India Post's answer → the area, or null when the PIN code is unknown. */
export function parsePincode(body: unknown): PincodeArea | null {
  const first = Array.isArray(body) ? (body[0] as { Status?: string; PostOffice?: unknown }) : null;
  const offices = Array.isArray(first?.PostOffice) ? (first!.PostOffice as { Name?: string; District?: string; State?: string }[]) : [];
  if (first?.Status !== 'Success' || offices.length === 0) return null;
  return {
    state: offices[0].State ?? '',
    district: offices[0].District ?? '',
    places: [...new Set(offices.map((o) => o.Name ?? '').filter(Boolean))],
  };
}

const PIN_RE = /^[1-9]\d{5}$/;

export async function lookupPincode(pin: string, signal?: AbortSignal): Promise<PincodeArea | null> {
  if (!PIN_RE.test(pin) || !(await integrationSwitches()).pincode) return null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal });
    return res.ok ? parsePincode(await res.json()) : null;
  } catch {
    return null;
  }
}

/** The area for a PIN code as it is typed — undefined while not asked or asking, null when unknown. */
export function usePincodeLookup(pin: string | undefined): PincodeArea | null | undefined {
  const [area, setArea] = useState<PincodeArea | null | undefined>(undefined);
  useEffect(() => {
    const value = (pin ?? '').trim();
    if (!PIN_RE.test(value)) {
      setArea(undefined);
      return;
    }
    const controller = new AbortController();
    setArea(undefined);
    lookupPincode(value, controller.signal).then((a) => !controller.signal.aborted && setArea(a));
    return () => controller.abort();
  }, [pin]);
  return area;
}

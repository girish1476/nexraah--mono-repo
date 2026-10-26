import { useEffect, useState } from 'react';
import { ALL_ON, type IntegrationSwitches } from './integrations';

/**
 * Which outside services an administrator has left switched on (Control →
 * Integrations), asked of the server once per page load.
 *
 * When the answer cannot be had — offline, the tests, a deployment without the
 * shared database — everything counts as on, which is how the console worked
 * before the switches existed. A switch can take a feature away; a failed
 * lookup of the switches never does.
 */

let asked: Promise<IntegrationSwitches> | null = null;

export function integrationSwitches(): Promise<IntegrationSwitches> {
  if (!asked) {
    asked =
      // No server to ask during unit tests (VITEST is never set in a browser build).
      typeof window === 'undefined' || typeof fetch === 'undefined' || process.env.VITEST
        ? Promise.resolve(ALL_ON)
        : fetch('/api/integrations/public', { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<Partial<IntegrationSwitches>>) : {}))
            .then((s) => ({ ...ALL_ON, ...s }))
            .catch(() => ALL_ON);
  }
  return asked;
}

/** Asks again on next use — after an administrator changes a switch. */
export function forgetIntegrationSwitches(): void {
  asked = null;
}

/** The switches, or null until they are known. */
export function useIntegrationSwitches(): IntegrationSwitches | null {
  const [switches, setSwitches] = useState<IntegrationSwitches | null>(null);
  useEffect(() => {
    let live = true;
    void integrationSwitches().then((s) => live && setSwitches(s));
    return () => {
      live = false;
    };
  }, []);
  return switches;
}

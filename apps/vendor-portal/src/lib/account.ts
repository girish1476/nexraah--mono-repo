'use client';

import { atom, useAtom } from 'jotai';
import { useEffect } from 'react';
import { getProfile } from '@/app/profile/apis';
import type { Profile } from '@/app/profile/types';
import { attentionSummary, type AttentionSummary } from './attention';

/**
 * The signed-in transporter's own record, fetched once and shared.
 *
 * The header sits on every screen and needs two things from it: who you are,
 * and whether a paper needs you. Fetching the profile again on each navigation
 * would put a request behind every tab press on a phone connection, so the
 * result is held in an atom and the in-flight promise is shared.
 */
export const profileAtom = atom<Profile | null>(null);

/** Shared so five screens mounting the header do not fire five requests. */
let inFlight: Promise<Profile> | null = null;

function fetchOnce(): Promise<Profile> {
  if (!inFlight) {
    inFlight = getProfile().catch((e) => {
      // Cleared on failure, so a transporter who loses signal in a tunnel and
      // comes back gets a retry rather than a permanently empty header.
      inFlight = null;
      throw e;
    });
  }
  return inFlight;
}

/** Call after an upload so the badge drops without a page reload. */
export function invalidateAccount(): void {
  inFlight = null;
}

export interface Account {
  profile: Profile | null;
  attention: AttentionSummary;
  refresh: () => void;
}

export function useAccount(): Account {
  const [profile, setProfile] = useAtom(profileAtom);

  useEffect(() => {
    let live = true;
    if (!profile) {
      fetchOnce()
        .then((p) => {
          if (live) setProfile(p);
        })
        // The header is not worth an error state. If it cannot load, it shows
        // the plain Profile link with no badge — which is what it did before
        // any of this existed, and never blocks the screen behind it.
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [profile, setProfile]);

  return {
    profile,
    attention: attentionSummary(profile),
    refresh: () => {
      invalidateAccount();
      setProfile(null);
    },
  };
}

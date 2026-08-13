import { atom } from 'jotai';
import type { TruckType } from '@/app/loads/types';

/**
 * Global jotai atoms. Keep cross-page state here; page-local state can
 * live inside the page folder.
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

export const userAtom = atom<User | null>(null);
export const isAuthenticatedAtom = atom((get) => get(userAtom) !== null);

/** Loads screen filter — survives navigation into a load and back. */
export const loadTypeFilterAtom = atom<TruckType[]>([]);

/** My quotes screen filter. */
export type QuoteFilter = 'All' | 'Open' | 'Won' | 'Lost';
export const quoteFilterAtom = atom<QuoteFilter>('All');

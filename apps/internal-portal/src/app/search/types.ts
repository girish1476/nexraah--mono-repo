import type { ModuleKey } from '@/lib/permissions';

/** The kinds of record global search can return. */
export type SearchKind = 'order' | 'trip' | 'indent' | 'client' | 'vendor' | 'invoice';

export interface SearchHit {
  kind: SearchKind;
  /** The code a person would have typed to find this — ORD-, TRP-, LR-, CLT-. */
  code: string;
  title: string;
  /** One line of context, so two similar codes are distinguishable at a glance. */
  detail: string;
  /** Where it stands, in plain words. Null when the record has no state worth showing. */
  state: string | null;
  href: string;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  order: 'Load',
  trip: 'Trip',
  indent: 'Load request',
  client: 'Client',
  vendor: 'Transporter',
  invoice: 'Client bill',
};

export const KIND_EMOJI: Record<SearchKind, string> = {
  order: '📦',
  trip: '🛣️',
  indent: '📝',
  client: '🏢',
  vendor: '🚛',
  invoice: '🧾',
};

/**
 * Which module each kind belongs to, so a hit is never shown to somebody who
 * cannot open it. Search is common to every role; what it *finds* still obeys
 * the same module matrix as the sidebar.
 */
export const KIND_MODULE: Record<SearchKind, ModuleKey> = {
  order: 'orders',
  trip: 'trips',
  indent: 'indents',
  client: 'clients',
  vendor: 'vendors',
  invoice: 'invoices',
};

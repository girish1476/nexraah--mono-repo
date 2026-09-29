import { listOrders } from '../orders/apis';
import { listTrips } from '../trips/apis';
import { listIndents } from '../indents/apis';
import { listClients } from '../clients/apis';
import { listVendors } from '../vendors/apis';
import { listInvoices } from '../invoices/apis';
import { inr } from '@/lib/format';
import { ORDER_STATUS_LABEL } from '../orders/types';
import { SearchHit, SearchKind } from './types';

/**
 * Global search fans out across the list endpoints that already take a query.
 *
 * Deliberately no new `/search` endpoint. Every one of these already filters
 * on the same text server-side, already applies that caller's branch scoping,
 * and already redacts what the caller may not see — a single search endpoint
 * would have to re-implement six sets of scoping rules, and the first one it
 * got wrong would hand somebody a record from a branch they cannot open.
 * Fanning out costs six round trips on a screen people use deliberately; it
 * cannot leak.
 *
 * A failing source yields nothing rather than failing the whole search. If
 * Invoices is down, looking for a trip number should still find the trip.
 */

const PER_KIND = 8;

async function safely<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

/** Trip stages in the words the rest of the console uses for them. */
const TRIP_STAGE_WORD: Record<string, string> = {
  OPEN: 'Booked, not started',
  IN_TRANSIT: 'On the road',
  DELIVERED: 'Unloaded',
  CLOSED: 'Closed',
};

/**
 * `/indents` and `/clients`-style endpoints filter differently — some take
 * `q`, some do not — so anything without server-side text search is filtered
 * here on the fields a person would actually have typed.
 */
function matches(term: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = term.toLowerCase();
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle));
}

/** An empty page of orders, shaped like a real one. See its use below. */
const EMPTY_ORDER_PAGE = { rows: [], total: 0, limit: PER_KIND, offset: 0 };

export async function searchEverywhere(q: string, kinds: SearchKind[]): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const wanted = (k: SearchKind) => kinds.length === 0 || kinds.includes(k);

  const [orders, trips, indents, clients, vendors, invoices] = await Promise.all([
    /*
     * `OrderListResponse` is a page, not a bare list, so the empty fallback has
     * to be a whole page too — `limit` and `offset` included. Without them the
     * build fails on the fallback rather than on any code path a search
     * actually takes, which is why it read as unrelated to search.
     */
    wanted('order')
      ? safely(listOrders({ q: term, limit: PER_KIND }), EMPTY_ORDER_PAGE)
      : Promise.resolve(EMPTY_ORDER_PAGE),
    wanted('trip') ? safely(listTrips({ q: term }), []) : Promise.resolve([]),
    wanted('indent') ? safely(listIndents(), []) : Promise.resolve([]),
    wanted('client') ? safely(listClients({ q: term }), []) : Promise.resolve([]),
    wanted('vendor') ? safely(listVendors({ q: term }), []) : Promise.resolve([]),
    wanted('invoice') ? safely(listInvoices({ q: term }), []) : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];

  for (const o of orders.rows.slice(0, PER_KIND)) {
    hits.push({
      kind: 'order',
      code: o.orderNo,
      title: o.lane,
      detail: `${o.clientName} · ${o.branchName}`,
      state: ORDER_STATUS_LABEL[o.status] ?? null,
      href: `/orders/${o.id}`,
    });
  }

  for (const t of trips.slice(0, PER_KIND)) {
    hits.push({
      kind: 'trip',
      // The lorry-receipt number is what a transporter or a client quotes on
      // the phone, so it leads whenever there is one.
      code: t.lrCode ?? t.code,
      title: t.lane,
      detail: `${t.vehicleNo} · ${t.vendorName}`,
      state: TRIP_STAGE_WORD[t.stage] ?? t.stage,
      href: `/trips/${t.id}`,
    });
  }

  // `/indents` takes no `q`, so the filter happens here on the fields somebody
  // would have typed: the indent code, the route, the client, the material.
  for (const i of indents
    .filter((r) => matches(term, r.code, r.lane, r.clientName, r.material, r.truckType))
    .slice(0, PER_KIND)) {
    hits.push({
      kind: 'indent',
      code: i.code,
      title: i.lane,
      detail: `${i.clientName} · ${i.truckType}`,
      state: i.stage,
      href: `/indents/${i.id}`,
    });
  }

  for (const c of clients.slice(0, PER_KIND)) {
    hits.push({
      kind: 'client',
      code: c.code,
      title: c.name,
      detail: `${c.billingCity} · ${c.engagement === 'CONTRACT' ? 'contract' : 'spot'}`,
      state: null,
      href: `/clients/${c.id}`,
    });
  }

  for (const v of vendors.slice(0, PER_KIND)) {
    hits.push({
      kind: 'vendor',
      code: v.code,
      title: v.legalName,
      detail: `${v.baseCity} · ${v.fleetCount} truck${v.fleetCount === 1 ? '' : 's'}`,
      state: v.status,
      href: `/vendors/${v.id}`,
    });
  }

  for (const inv of invoices.slice(0, PER_KIND)) {
    hits.push({
      kind: 'invoice',
      // A draft has no number yet. Saying so is better than showing a uuid.
      code: inv.code ?? 'Draft — no number yet',
      title: inv.clientName,
      detail: inr(inv.totalPaise),
      state: inv.status,
      href: `/invoices/${inv.id}`,
    });
  }

  return hits;
}

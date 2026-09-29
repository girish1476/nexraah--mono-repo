import { request } from '@/apis';
import { OrderCounts, OrderDetail, OrderListResponse, OrderStatus } from './types';

/**
 * Orders now come from the server.
 *
 * What this file used to be is worth recording, because it is the whole
 * reason the endpoint exists. It fetched `/indents`, `/trips` and `/invoices`
 * in full on every load, joined them in the browser, and ran a `statusFor()`
 * ladder over the result — twice, with different inputs. The list called it
 * with `advanceDocsUploaded: null` because the bulk `/trips` payload has no
 * per-document data; the detail called it with the real value. So one order
 * could legitimately render as "LR issued" in the list and "Advance documents
 * uploaded" on its own page, and both were "right".
 *
 * There is now one ladder, in `OrdersService`, and both screens read its
 * answer. The other things that came with it: a stable `ORD-` number that
 * survives the indent, a recorded step history, server-side filtering by step,
 * and paging — none of which a client-side join could offer.
 */

export interface ListOrdersParams {
  status?: OrderStatus;
  client?: string;
  branch?: string;
  /** Everything that has not reached "Balance released". */
  openOnly?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listOrders(params: ListOrdersParams = {}): Promise<OrderListResponse> {
  return request<OrderListResponse>({
    url: '/orders',
    method: 'GET',
    params: {
      status: params.status,
      client: params.client,
      branch: params.branch,
      open: params.openOnly ? '1' : undefined,
      q: params.q || undefined,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  });
}

/** Counts per step, for the phase tabs — one round trip, not one per tab. */
export async function orderCounts(branch?: string): Promise<OrderCounts> {
  return request<OrderCounts>({ url: '/orders/counts', method: 'GET', params: { branch } });
}

export async function getOrder(id: string): Promise<OrderDetail> {
  return request<OrderDetail>({ url: `/orders/${id}`, method: 'GET' });
}

/**
 * Re-derive one order from the records behind it.
 *
 * Not a way to set a status — there is deliberately no endpoint for that. Use
 * it to refresh an order right after acting on its trip or its payment,
 * instead of showing a step that is one action out of date.
 */
export async function recomputeOrder(id: string): Promise<void> {
  await request({ url: `/orders/${id}/recompute`, method: 'POST' });
}

import { ApiResponse, idempotent, request } from '@/apis';
import { USE_MOCK, mock } from '@/lib/mock';
import { Quote, QuoteStatus } from './types';

const FIXTURES: Quote[] = [
  {
    id: 'QT-8841',
    loadCode: 'LD-4471',
    originCity: 'Bhiwandi',
    destinationCity: 'Hyderabad',
    amountPaise: 4020000,
    status: 'SUBMITTED',
    submittedAt: '2026-08-10T11:20:00+05:30',
    aboveBandByPaise: null,
    tripId: null,
    lostReason: null,
  },
  {
    id: 'QT-8802',
    loadCode: 'LD-4443',
    originCity: 'Nashik',
    destinationCity: 'Kolkata',
    amountPaise: 5840000,
    status: 'WON',
    submittedAt: '2026-08-09T09:05:00+05:30',
    aboveBandByPaise: null,
    tripId: 'TR-20881',
    lostReason: null,
  },
  {
    id: 'QT-8790',
    loadCode: 'LD-4430',
    originCity: 'Pune',
    destinationCity: 'Surat',
    amountPaise: 2490000,
    status: 'LOST',
    submittedAt: '2026-08-08T16:40:00+05:30',
    aboveBandByPaise: null,
    tripId: null,
    lostReason: 'AWARDED_ELSEWHERE',
  },
  {
    id: 'QT-8776',
    loadCode: 'LD-4425',
    originCity: 'Vapi',
    destinationCity: 'Ludhiana',
    amountPaise: 5120000,
    status: 'WITHDRAWN',
    submittedAt: '2026-08-07T13:10:00+05:30',
    aboveBandByPaise: null,
    tripId: null,
    lostReason: null,
  },
];

export function getQuotes(statuses: QuoteStatus[] = []) {
  if (USE_MOCK) {
    return mock(FIXTURES.filter((q) => !statuses.length || statuses.includes(q.status)));
  }
  return request<ApiResponse<Quote[]>>({
    url: '/portal/quotes',
    method: 'GET',
    params: statuses.length ? { status: statuses.join(',') } : undefined,
  }).then((r) => r.data);
}

/**
 * Only while SUBMITTED — the API is the authority, the button is a courtesy.
 * Retry-safety contract as `attachPod` — `idempotencyKey` is the caller's.
 */
export function withdrawQuote(id: string, idempotencyKey: string) {
  if (USE_MOCK) return mock<void>(undefined);
  return idempotent<ApiResponse<void>>(idempotencyKey, {
    url: `/portal/quotes/${id}`,
    method: 'DELETE',
  }).then(() => undefined);
}

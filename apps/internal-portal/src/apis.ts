import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { mockAdapter, MOCKS_ENABLED } from '@/mocks';
import { clearSession, getToken, refreshSession } from '@/lib/auth';

/**
 * Root axios instance shared by every page-level `apis.ts`.
 * Auth headers, the response envelope, approval (202) and blocked (409)
 * handling all live here — page modules never create their own instance.
 *
 * Wire contract: docs/api/00-conventions.md
 */
export const api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4002/api/v1',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

if (MOCKS_ENABLED) {
  // Until internal-api ships the module, every call is served from
  // src/mocks/fixtures.ts. Set NEXT_PUBLIC_USE_MOCKS=0 to hit the real API.
  api.defaults.adapter = mockAdapter;
}

// ---- Request interceptor -------------------------------------------------

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // The bearer token is the whole of the caller's identity. The role rides
    // in the token's claims and is resolved server-side against our own
    // tables — there is no `X-Debug-Role` companion header any more, and a
    // real internal-api ignored it in any case (00-conventions.md §4).
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ---- Envelope, approvals and errors -------------------------------------

/** `{ success: true, data: T }` — the internal-api TransformInterceptor. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** Shape internal-api returns for a business failure (AllExceptionsFilter). */
export interface ApiErrorBody {
  code?: string;
  message?: string | string[];
  details?: unknown;
}

/** An unmet precondition named by the server. Never computed in the browser. */
export interface UnmetCondition {
  key: string;
  label: string;
  state: 'MISSING' | 'UNVERIFIED' | 'REJECTED' | 'BLOCKED';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** `409 ADVANCE_BLOCKED` / `BALANCE_BLOCKED` carry the list by name. */
  get unmet(): UnmetCondition[] {
    const d = this.details as { unmet?: UnmetCondition[] } | undefined;
    return d?.unmet ?? [];
  }
}

export interface Approval {
  id: string;
  kind:
    | 'ABOVE_BAND_PRICE'
    | 'ADVANCE_OVERRIDE'
    | 'ADVANCE_POLICY_CHANGE'
    | 'PENALTY_WAIVER'
    | 'DOC_OVERRIDE'
    | 'BRANCH_OVERRIDE';
  entityType: string;
  entityId: string;
  requesterId: string;
  requesterName?: string;
  approverRole: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

/**
 * `202 APPROVAL_REQUIRED` is not an error (part 01 §3). Callers catch this,
 * disable the originating control and show the amber banner.
 */
export class ApprovalRequiredError extends Error {
  readonly name = 'ApprovalRequiredError';
  constructor(readonly approval: Approval) {
    super(`Approval required: ${approval.kind}`);
  }
}

function toApiError(error: AxiosError): ApiError {
  const status = error.response?.status ?? 0;
  const body = error.response?.data as
    | { error?: ApiErrorBody | string; statusCode?: number }
    | undefined;
  const raw = body?.error;

  if (typeof raw === 'string') return new ApiError(status, 'ERROR', raw);
  if (raw && typeof raw === 'object') {
    const message = Array.isArray(raw.message)
      ? raw.message.join(', ')
      : raw.message ?? error.message;
    return new ApiError(status, raw.code ?? 'ERROR', message, raw.details);
  }
  return new ApiError(status, status ? 'ERROR' : 'NETWORK', error.message);
}

/**
 * An access token lives an hour; a screen left open outlives it routinely.
 * Rather than showing someone a failure for a token that expired while they
 * were reading, a 401 buys exactly one refresh-and-retry.
 *
 * "Exactly one" is the load-bearing part — `__retried` is set on the config
 * before the retry, so a refresh that succeeds against a request that is 401
 * for some *other* reason (a principal with no internal role, a disabled
 * account) fails the second time and stops, instead of looping.
 *
 * Concurrent 401s share one refresh: the first stores the promise, the rest
 * await it. Without that, ten calls firing on page load would each spend the
 * same refresh token, and the nine that lost the race would be retrying with
 * a token their own sibling had already rotated away.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshSession().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

type RetriableConfig = InternalAxiosRequestConfig & { __retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;

    if (error.response?.status === 401 && config && !config.__retried) {
      config.__retried = true;
      if (await refreshOnce()) return api.request(config);
    }

    if (error.response?.status === 401) {
      // Out of options: the refresh token is gone or spent too. Clear the
      // session so the next navigation lands on the sign-in screen rather
      // than retrying a token that will never work again.
      clearSession();
    }

    return Promise.reject(toApiError(error));
  },
);

/**
 * Unwraps the envelope and returns `data` directly.
 * Throws `ApprovalRequiredError` on 202 and `ApiError` on anything else.
 */
/**
 * A `FormData` body must not inherit this instance's JSON content type.
 *
 * The instance sets `Content-Type: application/json` for every call, and axios
 * reads that header before it looks at the body:
 *
 *   // axios/lib/defaults/index.js
 *   if (isFormData) {
 *     return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;
 *   }
 *
 * So a file appended to `FormData` is quietly flattened into a JSON string, the
 * file never leaves the browser, and `POST /attachments` answers
 * 400 "multipart field file is required". The fixture adapter ignores the body
 * entirely, so every demo and e2e run passes regardless — which is exactly why
 * this survived a previous fix that only changed the calling page.
 *
 * Clearing the header lets the browser set `multipart/form-data` together with
 * the boundary token, which is the one part we must never write by hand.
 */
function withMultipartHeader(config: AxiosRequestConfig): AxiosRequestConfig {
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;
  if (!isFormData) return config;
  return { ...config, headers: { ...config.headers, 'Content-Type': undefined } };
}

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await api.request<ApiEnvelope<T>>(withMultipartHeader(config));
  if (response.status === 202) {
    const payload = response.data?.data as unknown as {
      approvalRequired?: boolean;
      approval?: Approval;
    };
    if (payload?.approval) throw new ApprovalRequiredError(payload.approval);
  }
  return response.data?.data as T;
}

/**
 * `POST /payments/*` is idempotent on a client-supplied key (part 07 §4).
 * The key is minted once per attempt and reused across retries.
 */
export function idempotent<T>(key: string, config: AxiosRequestConfig): Promise<T> {
  return request<T>({
    ...config,
    headers: { ...config.headers, 'Idempotency-Key': key },
  });
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Turns any thrown value into something a panel can show. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export default api;

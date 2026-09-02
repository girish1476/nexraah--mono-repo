import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { clearSession } from './lib/auth';

/**
 * Root axios instance shared by every page-level `apis.ts`.
 * Add auth headers, logging, refresh-token logic, and global error
 * handling here — page modules should never create their own instance.
 */
export const api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4001/api/v1',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// ---- Request interceptor -------------------------------------------------
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ---- Response interceptor ------------------------------------------------
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      /*
       * The redirect was commented out because `/login` never existed — so a
       * expired session silently dropped the token and left the person on a
       * screen that failed every request from then on, with no way back.
       * `/signin` exists now.
       *
       * `clearSession()` rather than removing the one key: leaving the refresh
       * token behind would let `ensureFreshToken` resurrect a session the
       * server has already rejected.
       *
       * Guarded so the sign-in screen's own 401 does not bounce it off itself
       * into a loop, and `replace` so the back button does not walk into a
       * page that will only 401 again.
       */
      clearSession();
      if (!window.location.pathname.startsWith('/signin')) {
        window.location.replace('/signin');
      }
    }
    return Promise.reject(error);
  },
);

/** Every vendor-api response is wrapped by its transform interceptor. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * A `FormData` body must not inherit this instance's JSON content type.
 *
 * The instance sets `Content-Type: application/json` on every call, and axios
 * reads that header *before* it looks at the body — so a file appended to
 * `FormData` is quietly flattened into a JSON string, never leaves the browser,
 * and the server answers 400 "multipart field file is required". Clearing the
 * header lets the browser set `multipart/form-data` with its boundary token,
 * which is the one part that must never be written by hand.
 *
 * This is the same defect that silently broke every upload in the internal
 * console; it lives here too because both apps share the pattern.
 */
function withMultipartHeader(config: AxiosRequestConfig): AxiosRequestConfig {
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;
  if (!isFormData) return config;
  return { ...config, headers: { ...config.headers, 'Content-Type': undefined } };
}

/**
 * Every write route on the transporter surface requires an `Idempotency-Key`
 * and rejects the request outright without one — `assertIdempotencyKey()` in
 * `portal-*.controller.ts` throws before the handler runs.
 *
 * Nothing in this app was sending it, so *every* transporter write failed
 * against the real API: submitting a quote, withdrawing it, uploading proof of
 * delivery, submitting a bill, changing fleet, uploading a document. The demo
 * adapter does not check the header, so all of it appeared to work.
 *
 * Generated per request here rather than per call site, so a new write cannot
 * forget it. A caller that needs a *stable* key across retries — a genuine
 * replay of the same submission — can still pass its own and it is preserved.
 */
function withIdempotencyKey(config: AxiosRequestConfig): AxiosRequestConfig {
  const method = (config.method ?? 'get').toString().toUpperCase();
  if (method === 'GET' || method === 'HEAD') return config;
  const existing = config.headers?.['Idempotency-Key'];
  if (existing) return config;
  return { ...config, headers: { ...config.headers, 'Idempotency-Key': newIdempotencyKey() } };
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Thin helper that returns `response.data` directly. */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const { data } = await api.request<T>(withIdempotencyKey(withMultipartHeader(config)));
  return data;
}

/**
 * Every write route on the transporter surface is idempotent on a
 * caller-supplied key (see `withIdempotencyKey` above). A caller that wants
 * retry-safety — a genuine replay of the same submission, not a fresh one —
 * must mint the key ONCE per attempt with `newIdempotencyKey()` and pass the
 * same value through every call this helper makes for that attempt,
 * including a retry after a failed one. `request()` on its own cannot do
 * this: it mints a fresh key on every call, so a retry it wraps looks like a
 * brand new submission.
 *
 * Mirrors `idempotent()` in `apps/internal-portal/src/apis.ts`, which solves
 * the identical problem for that app's money-moving actions.
 */
export function idempotent<T>(key: string, config: AxiosRequestConfig): Promise<T> {
  return request<T>({
    ...config,
    headers: { ...config.headers, 'Idempotency-Key': key },
  });
}

export default api;

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';

/**
 * Root axios instance shared by every page-level `apis.ts`.
 * Add auth headers, logging, refresh-token logic, and global error
 * handling here — page modules should never create their own instance.
 */
export const api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4001/api',
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
      localStorage.removeItem('token');
      // window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

/** Every vendor-api response is wrapped by its transform interceptor. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/** Thin helper that returns `response.data` directly. */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const { data } = await api.request<T>(config);
  return data;
}

export default api;

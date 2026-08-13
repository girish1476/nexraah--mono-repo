import { request } from '@/apis';
import { HealthResponse } from './types';

/** Page-scoped API calls. Always go through the root `api` instance. */
export function getHealth() {
  return request<HealthResponse>({ url: '/health', method: 'GET' });
}

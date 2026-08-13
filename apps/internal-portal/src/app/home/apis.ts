import { request } from '@/apis';
import { HomeResponse } from './types';

/** GET /reports/home?month=YYYY-MM */
export function getHome(month?: string) {
  return request<HomeResponse>({ url: '/reports/home', method: 'GET', params: { month } });
}

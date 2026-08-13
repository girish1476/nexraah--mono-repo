import { request } from '@/apis';
import { Config, NumberSeries } from './types';

/** GET /config → Config */
export function getConfig() {
  return request<Config>({ url: '/config', method: 'GET' });
}

/** PATCH /config — partial. Writes a CONFIG audit row (NFR-03). */
export function patchConfig(patch: Partial<Config>) {
  return request<Config>({ url: '/config', method: 'PATCH', data: patch });
}

/** GET /config/number-series → NumberSeries[] (all nine of FSD B6) */
export function getNumberSeries() {
  return request<NumberSeries[]>({ url: '/config/number-series', method: 'GET' });
}

/**
 * PATCH /config/number-series/:key
 * 409 SERIES_LOWERED when nextValue is below a consumed value.
 */
export function patchNumberSeries(key: string, patch: Partial<NumberSeries>) {
  return request<NumberSeries>({ url: `/config/number-series/${key}`, method: 'PATCH', data: patch });
}

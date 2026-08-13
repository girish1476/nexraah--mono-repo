import { request } from '@/apis';
import { TelematicsResponse } from './types';

/**
 * GET /telematics — the live fleet board.
 *
 * Ingest is a provider webhook, `POST /telematics/ping`, HMAC-signed over the
 * raw body. It is not called from this application and carries no JWT.
 */
export function getTelematics() {
  return request<TelematicsResponse>({ url: '/telematics', method: 'GET' });
}

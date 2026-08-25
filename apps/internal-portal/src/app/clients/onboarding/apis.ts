import { request } from '@/apis';
import { ClientDocumentKind, ClientOnboardingDetail, ClientOnboardingRow } from './types';

/** Every client not yet cleared, oldest first. */
export async function listClientOnboarding(): Promise<ClientOnboardingRow[]> {
  return request<ClientOnboardingRow[]>({ url: '/clients/onboarding', method: 'GET' });
}

export async function getClientOnboarding(id: string): Promise<ClientOnboardingDetail> {
  return request<ClientOnboardingDetail>({ url: `/clients/${id}/onboarding`, method: 'GET' });
}

/**
 * Record a paper against a client.
 *
 * `attachmentId` is optional: some checks are done on a portal rather than
 * against a scan (a GSTIN looked up on the GST site, a credit report pulled
 * from a bureau), and forcing a file upload for those would push people into
 * attaching screenshots to satisfy the form.
 */
export async function submitClientDocument(
  id: string,
  body: {
    kind: ClientDocumentKind;
    attachmentId?: string;
    reference?: string;
    validFrom?: string;
    validTo?: string;
  },
): Promise<ClientOnboardingDetail> {
  return request<ClientOnboardingDetail>({
    url: `/clients/${id}/onboarding/documents`,
    method: 'POST',
    data: body,
  });
}

export async function decideClientDocument(
  id: string,
  kind: ClientDocumentKind,
  body: { status: 'VERIFIED' | 'REJECTED'; reason?: string },
): Promise<ClientOnboardingDetail> {
  return request<ClientOnboardingDetail>({
    url: `/clients/${id}/onboarding/documents/${kind}/decide`,
    method: 'POST',
    data: body,
  });
}

/** Refused by the server unless every required paper is verified. */
export async function activateClient(id: string): Promise<ClientOnboardingDetail> {
  return request<ClientOnboardingDetail>({ url: `/clients/${id}/onboarding/activate`, method: 'POST' });
}

export async function rejectClient(id: string, reason: string): Promise<ClientOnboardingDetail> {
  return request<ClientOnboardingDetail>({
    url: `/clients/${id}/onboarding/reject`,
    method: 'POST',
    data: { reason },
  });
}

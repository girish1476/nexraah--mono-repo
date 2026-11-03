import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AttachmentsService } from './attachments.service';
import type { AttachmentsRepository } from './attachments.repository';
import type { StorageService } from './storage.service';

/**
 * NFR-04: identity papers open only for the desks that verify them. That is
 * Compliance and the administrator — who is shown Verify and Reject on these
 * papers and was refused the very file (pre-prod, 3 Nov 2026).
 */
const rows: Record<string, { kind: string; storage_path: string; mime: string }> = {
  pan: { kind: 'PAN', storage_path: 'kyc/v-1/PAN/a.jpg', mime: 'image/jpeg' },
  yard: { kind: 'SELFIE', storage_path: 'kyc/v-1/SELFIE/b.jpg', mime: 'image/jpeg' },
  licence: { kind: 'TRADE_LICENCE', storage_path: 'documents/v-1/TRADE_LICENCE/c.pdf', mime: 'application/pdf' },
};

const service = new AttachmentsService(
  { findById: async (id: string) => rows[id] ?? null } as unknown as AttachmentsRepository,
  { createSignedUrl: async (path: string) => ({ url: `https://files/${path}`, expiresAt: 'later' }) } as unknown as StorageService,
);
const as = (role: string) => ({ role, userId: 'u-1' }) as unknown as AuthenticatedUser;

describe('who may open an identity paper', () => {
  it('Compliance and the administrator may', async () => {
    for (const role of ['COMPLIANCE', 'ADMIN']) {
      await expect(service.getSignedUrl('pan', as(role))).resolves.toMatchObject({ url: 'https://files/kyc/v-1/PAN/a.jpg', mime: 'image/jpeg' });
      await expect(service.getSignedUrl('yard', as(role))).resolves.toMatchObject({ mime: 'image/jpeg' });
    }
  });

  it('every other desk is refused, and told who may', async () => {
    for (const role of ['OPS', 'FINANCE', 'BD', 'LEADERSHIP', 'LOADING_SUPERVISOR']) {
      await expect(service.getSignedUrl('pan', as(role))).rejects.toMatchObject({
        message: 'Only Compliance and administrators can open identity documents.',
      });
    }
  });

  it('an ordinary paper opens for any desk', async () => {
    await expect(service.getSignedUrl('licence', as('OPS'))).resolves.toMatchObject({ mime: 'application/pdf' });
  });
});

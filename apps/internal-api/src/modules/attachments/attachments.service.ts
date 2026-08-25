import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AttachmentsRepository } from './attachments.repository';
import { StorageService } from './storage.service';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — part 01 §7, part 14 §7

// Server-side sniffed allow-list, part 14 §7. The client-side check
// (FE.md §224) is courtesy only.
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

// vendor_kyc.kind (part 02) — NFR-04: identity images are COMPLIANCE-only,
// and (modules/jobs's attachment-retention) held longer than the general
// retention window. Exported so the job reuses this exact set rather than
// re-declaring a second copy that could quietly drift from this one.
export const IDENTITY_KINDS = new Set(['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE']);

export interface UploadInput {
  buffer: Buffer;
  mime: string;
  kind?: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly storageService: StorageService,
  ) {}

  async upload(input: UploadInput, actor: AuthenticatedUser) {
    const ext = MIME_EXTENSIONS[input.mime];
    if (!ext) {
      throw new DomainException(
        400,
        'UNSUPPORTED_MIME',
        `${input.mime} is not accepted. Allowed: ${Object.keys(MIME_EXTENSIONS).join(', ')}.`,
      );
    }
    if (input.buffer.byteLength > MAX_BYTES) {
      throw new DomainException(400, 'FILE_TOO_LARGE', `File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit.`);
    }

    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const entityType = input.entityType ?? 'misc';
    const entityId = input.entityId ?? 'unassigned';
    const id = randomUUID();
    // Part 14 §7 names four category prefixes (pod/, bills/, kyc/, documents/)
    // keyed by domain context this generic endpoint doesn't have. entityType
    // stands in for that category until the owning wave (C3, C5, C6) uploads
    // through its own endpoint with real context.
    const storagePath = `${entityType}/${entityId}/${id}.${ext}`;

    await this.storageService.upload(storagePath, input.buffer, input.mime);

    const row = await this.attachmentsRepository.insert({
      id,
      kind: input.kind ?? entityType,
      entityType,
      entityId,
      storagePath,
      mime: input.mime,
      bytes: input.buffer.byteLength,
      sha256,
      uploadedBy: actor.userId,
    });

    return { id: row.id, sha256: row.sha256, uploadedAt: row.uploaded_at };
  }

  async getSignedUrl(id: string, actor: AuthenticatedUser) {
    const row = await this.attachmentsRepository.findById(id);
    if (!row) {
      throw new DomainException(404, 'NOT_FOUND', `Unknown attachment: ${id}`);
    }
    // NFR-04. The message reaches an operator's screen verbatim, so it says
    // who can open the file rather than citing the rule that says so.
    if (IDENTITY_KINDS.has(row.kind) && actor.role !== 'COMPLIANCE') {
      throw new DomainException(
        403,
        'PERMISSION_DENIED',
        'Only Compliance can open identity documents.',
      );
    }

    return this.storageService.createSignedUrl(row.storage_path);
  }
}

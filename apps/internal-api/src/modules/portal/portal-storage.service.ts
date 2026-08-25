import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createSupabaseClient } from '../../lib/supabase';
import { validateEnv } from '../../config/env';
import { portalError } from './portal.errors';
import { ALLOWED_UPLOAD_MIME, ATTACHMENT_RETENTION_YEARS, MAX_UPLOAD_BYTES } from './portal.constants';

const SIGNED_URL_TTL_SECONDS = 15 * 60; // 11-portal.md §4, 00-conventions.md §10

/**
 * The portal's own upload pipeline — deliberately NOT `AttachmentsService`.
 *
 * `AttachmentsModule` provides `AttachmentsRepository`, which injects `DB`; in
 * that module's context `DB` is the `@Global()` `InternalDbModule` binding, i.e.
 * `internalPool` as `internal_api`. Importing the module into `PortalModule` to
 * reach `StorageService` would put a provider graph fed by `internalPool` inside
 * the one module whose whole design is that it is not — `ADR-02` §3.1, and the
 * failure is silent, which is why this file exists instead. The ~40 lines
 * duplicated from `storage.service.ts` are the price of that boundary and are
 * cheaper than the boundary being wrong.
 *
 * The row-writing half is NOT here: `attachments` is inserted by the portal
 * repositories, inside the same transaction as the domain row, because
 * `11-portal.md` §4 requires exactly that ("INSERT attachments, INSERT
 * pod_receipts — one transaction"). This service owns bytes only.
 *
 * Two things it does that `AttachmentsService` does not, both required by §4:
 *
 * - **MIME is sniffed from content.** `AttachmentsService` trusts its caller's
 *   `input.mime`, which on this surface is `file.mimetype` — whatever the
 *   phone's browser chose to claim. `application/pdf` on an `.exe` costs
 *   nothing to send.
 * - **`sha256` is computed here, from the received bytes**, and no request
 *   field named `sha256` is read anywhere on this surface. "A client-supplied
 *   hash is a client-supplied claim."
 */
@Injectable()
export class PortalStorageService {
  private readonly logger = new Logger('PortalStorageService');
  private readonly env = validateEnv(process.env as Record<string, unknown>);
  private readonly client = createSupabaseClient(this.env);
  private readonly bucket = this.env.STORAGE_BUCKET;

  /**
   * Size, sniffed MIME and hash, before a single byte reaches storage and
   * before any transaction opens. `413`/`415` per §4 — and `multer`'s own
   * `limits.fileSize` rejection arrives as a Nest `413` that
   * `PortalExceptionFilter` already turns into `FILE_TOO_LARGE`, so a file too
   * big to buffer and one merely over the line fail identically.
   */
  prepare(file: PortalUploadFile): PreparedUpload {
    const buffer = file.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw portalError('VALIDATION_ERROR', 'That file arrived empty. Please attach it again.');
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw portalError('FILE_TOO_LARGE');
    }

    // Sniffed, never read from the part header. An unrecognised signature is
    // `415` whatever `Content-Type` claimed, and a claim that disagrees with
    // the bytes loses to the bytes.
    const mime = sniffMime(buffer);
    if (!mime) throw portalError('UNSUPPORTED_FILE_TYPE');

    return {
      buffer,
      mime,
      extension: ALLOWED_UPLOAD_MIME[mime],
      bytes: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      originalName: file.originalname ?? null,
    };
  }

  /**
   * Streams the part to Supabase Storage and hands back the row `attachments`
   * needs. Called BEFORE the transaction opens: a storage write cannot be
   * rolled back by Postgres, so the ordering that leaves the recoverable mess
   * is bytes-then-row (an orphan object, invisible and reapable) rather than
   * row-then-bytes (a domain row pointing at nothing, which is the one the
   * transporter cannot recover from themselves — §4).
   *
   * `category` is `11-portal.md` §4 / part 14 §7's prefix set: `pod`, `bills`,
   * `kyc`, `documents`.
   */
  async put(
    category: PortalUploadCategory,
    scopeId: string,
    prepared: PreparedUpload,
  ): Promise<PortalStoredFile> {
    const id = randomUUID();
    const storagePath = `${category}/${scopeId}/${id}.${prepared.extension}`;

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(storagePath, prepared.buffer, { contentType: prepared.mime, upsert: false });

    if (error) {
      // The provider's message can name the bucket and the object key; neither
      // is the transporter's business, and `STORAGE_UNAVAILABLE` is the honest
      // thing to retry against.
      this.logger.error(`portal upload to ${storagePath} failed: ${error.message}`);
      throw portalError('STORAGE_UNAVAILABLE');
    }

    return {
      id,
      storagePath,
      mime: prepared.mime,
      bytes: prepared.bytes,
      sha256: prepared.sha256,
      // "Set server-side from policy. Not a request field." No `config` key
      // names a retention period and `config` is unreachable from this pool —
      // `ATTACHMENT_RETENTION_YEARS` records why.
      retainUntil: retainUntil(),
    };
  }

  /** 15 minutes, §4. Null rather than a throw — a missing link is not a failed read. */
  async signedUrl(storagePath: string): Promise<string | null> {
    try {
      const { data, error } = await this.client.storage
        .from(this.bucket)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        this.logger.warn(`could not sign ${storagePath}: ${error?.message ?? 'no data'}`);
        return null;
      }
      return data.signedUrl;
    } catch (error) {
      this.logger.warn(
        `could not sign ${storagePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

export type PortalUploadCategory = 'pod' | 'bills' | 'kyc' | 'documents';

/**
 * The shape `multer`'s memory storage hands a handler. Declared structurally
 * rather than as `Express.Multer.File` so that nothing in this module depends
 * on the ambient `@types/multer` global being loaded.
 */
export interface PortalUploadFile {
  buffer?: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

export interface PreparedUpload {
  buffer: Buffer;
  mime: string;
  extension: string;
  bytes: number;
  sha256: string;
  originalName: string | null;
}

export interface PortalStoredFile {
  id: string;
  storagePath: string;
  mime: string;
  bytes: number;
  sha256: string;
  retainUntil: string;
}

/**
 * Magic-number sniff over `ALLOWED_UPLOAD_MIME`. Three signatures, all of them
 * at offset 0 and none of them ambiguous, so there is no need for a dependency
 * here — and a dependency that guessed would be worse than a table that does
 * not: everything it fails to recognise is `415`, which is the safe direction.
 */
function sniffMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // A PDF's `%PDF-` header is permitted a small amount of leading junk by
  // readers in the wild; the check stays at offset 0 because a file that needs
  // the slack is one this surface would rather refuse than store.
  if (buffer.length >= 5 && buffer.subarray(0, 5).equals(PDF_SIGNATURE)) return 'application/pdf';
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');

function retainUntil(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + ATTACHMENT_RETENTION_YEARS);
  return date.toISOString().slice(0, 10);
}

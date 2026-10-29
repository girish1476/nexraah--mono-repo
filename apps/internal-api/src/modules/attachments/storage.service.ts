import { Injectable } from '@nestjs/common';
import { createSupabaseClient } from '../../lib/supabase';
import { validateEnv } from '../../config/env';
import { DomainException } from '../../common/domain-exception';
import { deleteObject, fileLink, getObject, putObject, s3Config } from '../../lib/object-store';

const SIGNED_URL_TTL_SECONDS = 15 * 60; // 15 minutes — part 01 §7, 00-conventions §10

/**
 * Part 14 §7: one private bucket, deny-all storage policies, every read a
 * 15-minute signed URL minted after the API has checked the caller may see
 * the row. Uploads and signed URLs both go through the anon-key client from
 * `lib/supabase.ts` (part 14 §4: the JS client's two jobs are verifying a
 * JWT — done elsewhere, with `jose` — and Storage).
 *
 * Part 14 §5.2's `revoke ... from anon, authenticated` is a Postgres grant on
 * the `public` schema; `storage.objects` carries its own, separately
 * configured RLS that no migration in this repo touches. Whether the anon
 * key can write into this bucket depends entirely on that untouched policy —
 * this service assumes a policy exists (or `service_role` is deliberately
 * substituted here, at deploy time, as an explicit exception to part 14 §4's
 * blanket ban, since Storage write is unavoidably a server-side privileged
 * operation). Flagging this rather than silently assuming: nothing in the
 * spec set names which route is intended.
 *
 * Resolved (29 Oct 2026): neither. With STORAGE_S3_* set — Storage's own S3
 * access keys, which reach the bucket and not Postgres — every call below goes
 * over S3 and reads are links this API signs (lib/object-store.ts). The anon
 * client remains only for a setup without those keys, such as a local
 * Supabase whose bucket policy admits it.
 */
@Injectable()
export class StorageService {
  private readonly client = createSupabaseClient(validateEnv(process.env as Record<string, unknown>));
  private readonly bucket = validateEnv(process.env as Record<string, unknown>).STORAGE_BUCKET;
  private readonly s3 = s3Config();

  async upload(path: string, buffer: Buffer, mime: string): Promise<void> {
    if (this.s3) {
      await putObject(this.s3, path, buffer, mime).catch((e: Error) => {
        throw new DomainException(502, 'STORAGE_UPLOAD_FAILED', e.message);
      });
      return;
    }
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (error) {
      throw new DomainException(502, 'STORAGE_UPLOAD_FAILED', error.message);
    }
  }

  /** The file's bytes, for the one server-side reader of a document — `modules/ocr`. Never sent to a browser from here. */
  async download(path: string): Promise<Buffer> {
    if (this.s3) {
      const object = await getObject(this.s3, path).catch((e: Error) => {
        throw new DomainException(502, 'STORAGE_DOWNLOAD_FAILED', e.message);
      });
      return object.body;
    }
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) {
      throw new DomainException(502, 'STORAGE_DOWNLOAD_FAILED', error?.message ?? 'Unable to read the file.');
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /** `attachment-retention` (modules/jobs) is the one caller — everywhere else only ever uploads or signs. */
  async remove(path: string): Promise<void> {
    if (this.s3) {
      await deleteObject(this.s3, path).catch((e: Error) => {
        throw new DomainException(502, 'STORAGE_DELETE_FAILED', e.message);
      });
      return;
    }
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) {
      throw new DomainException(502, 'STORAGE_DELETE_FAILED', error.message);
    }
  }

  async createSignedUrl(path: string): Promise<{ url: string; expiresAt: string }> {
    if (this.s3) return fileLink(this.s3, path);
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      throw new DomainException(502, 'STORAGE_SIGN_FAILED', error?.message ?? 'Unable to sign URL.');
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }
}

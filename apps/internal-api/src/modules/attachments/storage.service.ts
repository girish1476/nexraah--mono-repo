import { Injectable } from '@nestjs/common';
import { createSupabaseClient } from '../../lib/supabase';
import { validateEnv } from '../../config/env';
import { DomainException } from '../../common/domain-exception';

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
 */
@Injectable()
export class StorageService {
  private readonly client = createSupabaseClient(validateEnv(process.env as Record<string, unknown>));
  private readonly bucket = validateEnv(process.env as Record<string, unknown>).STORAGE_BUCKET;

  async upload(path: string, buffer: Buffer, mime: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (error) {
      throw new DomainException(502, 'STORAGE_UPLOAD_FAILED', error.message);
    }
  }

  /** `attachment-retention` (modules/jobs) is the one caller — everywhere else only ever uploads or signs. */
  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) {
      throw new DomainException(502, 'STORAGE_DELETE_FAILED', error.message);
    }
  }

  async createSignedUrl(path: string): Promise<{ url: string; expiresAt: string }> {
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

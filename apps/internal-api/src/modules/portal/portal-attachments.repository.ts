import { Injectable } from '@nestjs/common';
import type { DbExecutor } from '../../db/kysely';
import type { PortalStoredFile } from './portal-storage.service';

/**
 * The `attachments` INSERT for all three multipart writes — `11-portal.md` §4:
 *
 * > **The upload-then-reference pattern is preserved server-side.** The portal
 * > handler writes the `attachments` row first, then the domain row, in one
 * > transaction. The transporter never sees an attachment id and never sends
 * > one.
 *
 * Every method therefore takes the caller's `DbExecutor` rather than holding a
 * connection: the attachment row and the `pod_receipts` / `vendor_bills` /
 * `vendor_kyc` row it belongs to commit together or not at all, so a POD can
 * never end up pointing at a file that was rolled away, and a file can never
 * end up referenced by nothing.
 *
 * `vendor_api` holds `select, insert` on `attachments` and no `update` or
 * `delete` (`20260814090200` §2) — a stored file's hash, size and owner cannot
 * be rewritten after the fact, by this surface or any request that reaches it.
 *
 * Deliberately NOT `AttachmentsRepository`: see the head of
 * `portal-storage.service.ts`. That one is constructed against `internalPool`.
 */
@Injectable()
export class PortalAttachmentsRepository {
  /**
   * `sha256`, `bytes`, `mime` and `retain_until` all come off `PortalStoredFile`
   * — i.e. from the bytes the server received and from policy, never from a
   * request field (§4). `uploadedBy` is the seeded "Portal System" `users.id`;
   * `attachments.uploaded_by` is a hard FK to the internal `users` table and
   * there is no transporter row in it to point at.
   */
  async insert(
    db: DbExecutor,
    file: PortalStoredFile,
    row: { kind: string; entityType: string; entityId: string; uploadedBy: string },
  ): Promise<string> {
    const inserted = await db
      .insertInto('attachments')
      .values({
        // The id is minted alongside the storage path so that the path and the
        // row agree — the path is `<category>/<scope>/<id>.<ext>` and a
        // database-generated id would not be in it.
        id: file.id,
        kind: row.kind,
        entity_type: row.entityType,
        entity_id: row.entityId,
        storage_path: file.storagePath,
        mime: file.mime,
        bytes: file.bytes,
        sha256: file.sha256,
        uploaded_by: row.uploadedBy,
        retain_until: file.retainUntil,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return inserted.id;
  }

  async insertMany(
    db: DbExecutor,
    files: PortalStoredFile[],
    row: { kind: string; entityType: string; entityId: string; uploadedBy: string },
  ): Promise<string[]> {
    const ids: string[] = [];
    // Sequential rather than `Promise.all`: these share one transaction, and a
    // Kysely transaction is one connection — concurrent statements on it are a
    // race, not a speed-up.
    for (const file of files) {
      ids.push(await this.insert(db, file, row));
    }
    return ids;
  }

  /** The storage path behind an id, for signing. Vendor scoping is the caller's. */
  async storagePath(db: DbExecutor, id: string): Promise<string | undefined> {
    const row = await db
      .selectFrom('attachments')
      .select('storage_path as storagePath')
      .where('id', '=', id)
      .executeTakeFirst();
    return row?.storagePath;
  }
}

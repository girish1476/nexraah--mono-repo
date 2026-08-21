import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

@Injectable()
export class AttachmentsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  insert(row: {
    id: string;
    kind: string;
    entityType: string;
    entityId: string;
    storagePath: string;
    mime: string;
    bytes: number;
    sha256: string;
    uploadedBy: string;
  }) {
    return this.db
      .insertInto('attachments')
      .values({
        id: row.id,
        kind: row.kind,
        entity_type: row.entityType,
        entity_id: row.entityId,
        storage_path: row.storagePath,
        mime: row.mime,
        bytes: row.bytes,
        sha256: row.sha256,
        uploaded_by: row.uploadedBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findById(id: string) {
    return this.db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
  }
}

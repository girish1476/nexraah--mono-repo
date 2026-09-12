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
    geoLat?: number | null;
    geoLng?: number | null;
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
        geo_lat: row.geoLat != null ? String(row.geoLat) : null,
        geo_lng: row.geoLng != null ? String(row.geoLng) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findById(id: string) {
    return this.db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** `attachment-retention` job — past its `retain_until` date, excluding identity-kind KYC uploads (kept longer, per NFR-04). */
  findExpired(excludeKinds: string[]) {
    return this.db
      .selectFrom('attachments')
      .select(['id', 'storage_path', 'kind', 'retain_until'])
      .where('retain_until', 'is not', null)
      .where('retain_until', '<', new Date().toISOString().slice(0, 10))
      .where('kind', 'not in', excludeKinds)
      .execute();
  }

  deleteById(id: string) {
    return this.db.deleteFrom('attachments').where('id', '=', id).execute();
  }
}

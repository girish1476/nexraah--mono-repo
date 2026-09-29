import { request } from '@/apis';

/**
 * Uploads a file through `/attachments` and returns its id — for the places that
 * attach evidence (an approval mail's screenshot) to something they are about to
 * record.
 */
export async function uploadAttachment(file: File, kind: string, entityType: string, entityId: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  const uploaded = await request<{ id: string }>({ url: '/attachments', method: 'POST', data: form });
  return uploaded.id;
}

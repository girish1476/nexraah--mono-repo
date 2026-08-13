import { request } from '@/apis';
import { ImportBatch, ImportSet } from './types';

/**
 * POST /admin/import/:set · `config.manage` · multipart
 * Returns a batch id and the dry-run report. **Nothing is written.**
 */
export function dryRun(set: ImportSet, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ImportBatch>({
    url: `/admin/import/${set}`,
    method: 'POST',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * POST /admin/import/:set/commit  { batchId } · `config.manage`
 * One transaction. A partial import is not a state this system has.
 */
export function commit(set: ImportSet, batchId: string) {
  return request<ImportBatch>({ url: `/admin/import/${set}/commit`, method: 'POST', data: { batchId } });
}

/** GET /admin/import/history — batches with actor, file hash and row counts. */
export function getImportHistory() {
  return request<ImportBatch[]>({ url: '/admin/import/history', method: 'GET' });
}

import { request } from '@/apis';
import { Branch, BranchDraft, BranchPatch } from './types';

/** GET /branches — every branch, active anywhere a branch selector appears. */
export function listBranches() {
  return request<Branch[]>({ url: '/branches', method: 'GET' });
}

/** POST /branches · `config.manage` — an administrator opens a new branch. */
export function createBranch(draft: BranchDraft) {
  return request<Branch>({ url: '/branches', method: 'POST', data: draft });
}

/** PATCH /branches/:id · `config.manage` — supply source and remarks. */
export function updateBranch(id: string, patch: BranchPatch) {
  return request<Branch>({ url: `/branches/${id}`, method: 'PATCH', data: patch });
}

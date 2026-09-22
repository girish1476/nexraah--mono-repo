'use client';

import { useParams } from 'next/navigation';
import { ModuleGuard, PageHeader, PageIntro } from '@/lib/ui';
import { TripTabs } from '../tabs';
import { TripDocumentsContent } from './content';

/**
 * Documents tab — `/trips/[id]/documents` (part 05 §3).
 *
 * Five groups, eleven documents. Eight gate the advance, and fitness, permit
 * and PUC are in that set. A cross-check mismatch blocks LR generation until
 * it is rejected or overridden — catching it after dispatch catches nothing.
 *
 * The actual upload/verify/reject/cross-check workflow lives in
 * `TripDocumentsContent` (`./content.tsx`) — this route is now just that
 * component wrapped in this page's own header and tab strip, so the order
 * detail page's Documents tab can embed the identical, fully working thing.
 */
export default function TripDocumentsPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <ModuleGuard module="trips">
      <PageHeader
        path={`/trips/${id}/documents`}
        title="Trip documents"
        sub="Eleven documents in five groups. Eight of them must be verified before the advance can be released."
        module="trips"
      />
      <PageIntro
        what="Upload, verify or reject each of this trip's required documents — a cross-check mismatch here blocks LR generation until it's resolved."
        who="Operations desk uploads; compliance verifies."
      />
      <TripTabs tripId={id} />

      <TripDocumentsContent tripId={id} />
    </ModuleGuard>
  );
}

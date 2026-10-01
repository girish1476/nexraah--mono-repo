'use client';

import { useParams } from 'next/navigation';
import { OrderDocumentsTab } from '@/app/orders/[id]/documents-tab';
import { ModuleGuard, PageHeader, PageIntro } from '@/lib/ui';
import { TripTabs } from '../tabs';

/**
 * Documents tab — `/trips/[id]/documents`.
 *
 * The same document cards as the order page's Documents tab — each document's
 * photo (or the vehicle papers as one PDF) beside the details on it — so the
 * loading supervisor, who works from the trip rather than the order, uploads
 * the loading and vehicle documents the same way Operations does. Uploads open
 * once loading is complete; Compliance verifies or rejects on each card.
 *
 * The lorry receipt has its own tab here, so it is left out of this page.
 */
export default function TripDocumentsPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <ModuleGuard module="trips">
      <PageHeader
        path={`/trips/${id}/documents`}
        title="Trip documents"
        sub="Each document with its photo and the details on it. The advance is released once they are verified."
        module="trips"
      />
      <PageIntro
        what="Upload the loading and vehicle documents once loading is complete; Compliance verifies or rejects each one on its card."
        who="The trip's loading supervisor or Operations uploads; Compliance verifies."
      />
      <TripTabs tripId={id} />

      <OrderDocumentsTab tripId={id} onChanged={() => undefined} showLr={false} />
    </ModuleGuard>
  );
}

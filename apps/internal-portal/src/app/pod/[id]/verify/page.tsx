'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { fmtDate } from '@/lib/format';
import { ModuleGuard, PageHeader, PageIntro } from '@/lib/ui';
import { PodDetail } from '../../types';
import { PodVerifyContent } from './content';

/**
 * Verify and approve — `/pod/[id]/verify` (part 06 §3).
 *
 * Two acts, two people. The verifier cannot approve their own proof of
 * delivery: the button does not render, the service refuses, and a database
 * constraint refuses as well (BR-50). Charges are captured here, because
 * verification is the moment someone is actually reading the document.
 *
 * The actual document/checklist/charges/approve workflow lives in
 * `PodVerifyContent` (`./content.tsx`) — this route wraps it in this page's
 * own header, mirrored from the content's `onLoaded` callback rather than
 * fetched a second time, so the order detail page's Tracking status tab can
 * embed the identical, fully working thing without this page's chrome. The
 * header prints a plain placeholder for the one frame before `onLoaded`
 * fires and upgrades to the trip-specific title — `PodVerifyContent` itself
 * stays mounted throughout, so that's one fetch, not two.
 */
export default function PodVerifyPage() {
  const { id } = useParams<{ id: string }>();
  const [pod, setPod] = useState<PodDetail | null>(null);

  return (
    <ModuleGuard module="pod">
      {pod ? (
        <PageHeader
          path={`/pod/${pod.tripCode}/verify`}
          title={`Proof of delivery · ${pod.tripCode}`}
          sub={`${pod.lane} · ${pod.vendorName} · delivered ${fmtDate(pod.deliveredAt)}`}
          module="pod"
        />
      ) : (
        <PageHeader path={`/pod/${id}/verify`} title="Proof of delivery" module="pod" />
      )}
      <PageIntro
        what="The photograph pages for this delivery, a checklist to confirm they're valid, and any charges written on the document — verify it here, or reject it and send it back for a replacement."
        who="Verification and approval are two different people: whoever verifies the document can't be the one who approves it, and only an approval unblocks the balance."
      />

      <PodVerifyContent tripId={id} onLoaded={setPod} />
    </ModuleGuard>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inrCompact, pct } from '@/lib/format';
import {
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
} from '@/lib/ui';
import { listRfqs } from './apis';
import { RfqListResponse, RfqStatus } from './types';

const TONE: Record<RfqStatus, Tone> = {
  DRAFT: 'grey',
  SOURCING: 'blue',
  QUOTED: 'flag',
  SUBMITTED: 'blue',
  AWARDED: 'mint',
  LOST: 'red',
  CLOSED: 'grey',
};

/** RFQ list — `/rfq` (part 09 §1). Win lanes at a price that can be served. */
export default function RfqPage() {
  const router = useRouter();
  const [data, setData] = useState<RfqListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listRfqs().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading RFQs" />;

  const winRate = data.stats.lanesWon + data.stats.lanesLost
    ? (data.stats.lanesWon / (data.stats.lanesWon + data.stats.lanesLost)) * 100
    : 0;

  const columns: Column<RfqListResponse['rows'][number]>[] = [
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'ref', label: 'Reference', mono: true, render: (r) => r.reference },
    { key: 'cycle', label: 'Cycle', align: 'right', render: (r) => `${r.cycleMonths} months` },
    { key: 'period', label: 'Period', render: (r) => `${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}` },
    { key: 'due', label: 'Quote due by', render: (r) => fmtDate(r.dueAt) },
    { key: 'lanes', label: 'Routes', align: 'right', render: (r) => r.laneCount },
    { key: 'status', label: 'Status', render: (r) => <Tag tone={TONE[r.status]}>{r.status}</Tag> },
  ];

  return (
    <ModuleGuard module="rfq">
      <PageHeader path="/rfq" title="Rate requests" module="rfq" />
      <PageIntro
        what="Winning a lane — a route you'll run for a client again and again — at a price that still works once a transporter is paid."
        who="Operations builds these; leadership submits them to the client."
      >
        This happens before any single load. A lane won here is what an indent can then be raised
        against. Each request moves through: draft, sourcing (finding what transporters would carry
        it for), quoted, submitted to the client, then won or lost.
      </PageIntro>

      <Stack>
        <StatStrip
          stats={[
            { k: 'Live rate requests', id: 'rfq-live', emoji: '💬', v: data.stats.open },
            { k: 'Routes we are pricing', id: 'rfq-pricing', emoji: '🔎', v: data.stats.lanesOut },
            { k: 'Routes we won', id: 'rfq-won', emoji: '🏆', v: data.stats.lanesWon, tone: 'mint' },
            { k: 'Routes we lost', id: 'rfq-lost', emoji: '❌', v: data.stats.lanesLost, tone: 'red' },
            { k: 'Share we win', id: 'rfq-win-rate', emoji: '📊', v: pct(winRate) },
            { k: 'Business won', id: 'rfq-value-won', emoji: '💰', v: inrCompact(data.stats.valueWonPaise), tone: 'mint' },
          ]}
        />
        <Panel pad={false}>
          <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/rfq/${r.id}`)} />
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

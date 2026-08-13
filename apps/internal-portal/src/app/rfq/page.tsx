'use client';

import Link from 'next/link';
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
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
  useLevel,
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
  const level = useLevel('rfq');
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
    { key: 'due', label: 'Submission due', render: (r) => fmtDate(r.dueAt) },
    { key: 'lanes', label: 'Lanes', align: 'right', render: (r) => r.laneCount },
    { key: 'status', label: 'Status', render: (r) => <Tag tone={TONE[r.status]}>{r.status}</Tag> },
  ];

  return (
    <ModuleGuard module="rfq">
      <PageHeader
        path="/rfq"
        title="RFQ"
        sub="Draft → Sourcing → Quoted → Submitted → Awarded"
        module="rfq"
        right={
          level === 'EDIT' && (
            <Link href="/rfq/new" className="btn">
              New RFQ
            </Link>
          )
        }
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Open RFQs', v: data.stats.open },
            { k: 'Lanes out to bid', v: data.stats.lanesOut },
            { k: 'Lanes won', v: data.stats.lanesWon, tone: 'mint' },
            { k: 'Lanes lost', v: data.stats.lanesLost, tone: 'red' },
            { k: 'Win rate', v: pct(winRate) },
            { k: 'Value won', v: inrCompact(data.stats.valueWonPaise), tone: 'mint' },
          ]}
        />
        <Panel pad={false}>
          <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/rfq/${r.id}`)} />
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { listMarketGap, updateMarketGapTarget } from '../apis';
import { MarketGapRow } from '../types';

/**
 * Market gap — `/vendors/market-gap` (part 03 §3, D-19).
 *
 * A lane that draws no in-band quote is a recruitment problem, never a
 * licence to widen the band (BR-39). This screen is where that shortfall is
 * recorded and worked.
 */
export default function MarketGapPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<MarketGapRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listMarketGap().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<MarketGapRow>[] = [
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'lane', label: 'Lane under pressure', render: (r) => r.lane },
    { key: 'truck', label: 'Truck needed', render: (r) => r.truckType },
    {
      key: 'target',
      label: 'Target',
      align: 'right',
      render: (r) =>
        can('vendor.edit') ? (
          <input
            type="number"
            defaultValue={r.target}
            style={{
              width: 64,
              padding: '4px 6px',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'inherit',
            }}
            onBlur={async (e) => {
              const target = Number(e.target.value);
              if (target === r.target) return;
              try {
                const updated = await updateMarketGapTarget(r.id, target);
                setRows((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
                toast(`${r.lane} target set to ${target}`);
              } catch (err) {
                toast(errorMessage(err));
              }
            }}
          />
        ) : (
          r.target
        ),
    },
    { key: 'panel', label: 'On panel', align: 'right', render: (r) => r.onPanel },
    { key: 'conv', label: 'Converted', align: 'right', render: (r) => r.converted },
    {
      key: 'gap',
      label: 'Gap',
      align: 'right',
      render: (r) => <Tag tone={r.gap > 0 ? 'red' : 'mint'}>{r.gap}</Tag>,
    },
    {
      key: 'progress',
      label: 'Progress',
      render: (r) => (
        <div style={{ minWidth: 120 }}>
          <div className="bar">
            <span style={{ width: `${Math.min(100, r.progressPct)}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {r.progressPct}%
          </div>
        </div>
      ),
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/market-gap"
        title="Market gap"
        sub="Where the panel is thin. A repeat placement failure on a lane belongs here, not in a wider band."
        module="vendors"
      />
      <Stack>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading market gap" />}
        {rows && (
          <Panel pad={false}>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No gap recorded." />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}

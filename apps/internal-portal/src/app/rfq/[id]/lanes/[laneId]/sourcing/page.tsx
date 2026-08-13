'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { inr } from '@/lib/format';
import {
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useLevel,
  useToast,
} from '@/lib/ui';
import { getRfq, setSourcing } from '../../../../apis';
import { RfqLane, SourcingMode, SourcingRow } from '../../../../types';

/**
 * Sourcing rates — `/rfq/[id]/lanes/[laneId]/sourcing` (part 09 §1).
 *
 * Monthly: a rate per month across the period, averaged. High/low: two
 * figures and the midpoint. Operations supplies it, and a soft number here
 * wins a lane that cannot be served (R-03).
 */
export default function SourcingPage() {
  const { id, laneId } = useParams<{ id: string; laneId: string }>();
  const router = useRouter();
  const toast = useToast();
  const level = useLevel('rfq');

  const [lane, setLane] = useState<RfqLane | null>(null);
  const [periodFrom, setPeriodFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SourcingMode>('MONTHLY');
  const [rows, setRows] = useState<SourcingRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRfq(id)
      .then((rfq) => {
        const found = rfq.lanes.find((l) => l.id === laneId);
        if (!found) throw new Error('Lane not found');
        setLane(found);
        setPeriodFrom(rfq.periodFrom);
        setMode(found.sourcingMode);
        setRows(
          found.sourcingRows.length
            ? found.sourcingRows
            : found.sourcingMode === 'MONTHLY'
              ? monthsOf(rfq.periodFrom, 3)
              : [
                  { month: null, ratePaise: 0 },
                  { month: null, ratePaise: 0 },
                ],
        );
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id, laneId]);

  const switchMode = (next: SourcingMode) => {
    setMode(next);
    setRows(
      next === 'MONTHLY'
        ? monthsOf(periodFrom, 3)
        : [
            { month: null, ratePaise: 0 },
            { month: null, ratePaise: 0 },
          ],
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const updated = await setSourcing(id, laneId, { sourcingMode: mode, sourcingRows: rows });
      setLane(updated);
      toast(`Sourcing average ${inr(updated.sourcingAvgPaise)}`);
      router.push(`/rfq/${id}/lanes/${laneId}/quote`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} />;
  if (!lane) return <Loading what="Loading the lane" />;

  const rates = rows.map((r) => r.ratePaise).filter((r) => r > 0);
  const avg = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

  return (
    <ModuleGuard module="rfq">
      <PageHeader
        path={`/rfq/${id}/lanes/${laneId}/sourcing`}
        title={`${lane.origin} → ${lane.destination}`}
        sub={`${lane.truckType} · sourcing rates supplied by operations`}
        module="rfq"
        right={<Tag tone="grey">{mode.replace('_', '/')}</Tag>}
      />

      <Stack>
        <Panel title="Mode">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['MONTHLY', 'HIGH_LOW'] as SourcingMode[]).map((m) => (
              <button
                key={m}
                className={m === mode ? 'btn btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => switchMode(m)}
                disabled={level !== 'EDIT'}
              >
                {m === 'MONTHLY' ? 'Monthly rates' : 'High / low'}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={mode === 'MONTHLY' ? 'Rate per month' : 'High and low'}>
          <FormGrid>
            {rows.map((row, i) => (
              <Field key={i} label={mode === 'MONTHLY' ? (row.month ?? `Month ${i + 1}`) : i === 0 ? 'Low (₹)' : 'High (₹)'}>
                <input
                  type="number"
                  value={row.ratePaise ? row.ratePaise / 100 : ''}
                  disabled={level !== 'EDIT'}
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (i === j ? { ...r, ratePaise: Number(e.target.value) * 100 } : r)))
                  }
                />
              </Field>
            ))}
          </FormGrid>
          {mode === 'MONTHLY' && level === 'EDIT' && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => setRows([...rows, { month: nextMonth(rows), ratePaise: 0 }])}
            >
              Add a month
            </button>
          )}
          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="eyebrow">{mode === 'MONTHLY' ? 'Average' : 'Midpoint'}</span>
            <span className="mono" style={{ fontSize: 20 }}>
              {inr(avg)}
            </span>
          </div>
          {level === 'EDIT' && (
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={save} disabled={busy || avg === 0}>
                Save and build the quote
              </button>
            </div>
          )}
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

function monthsOf(from: string, count: number): SourcingRow[] {
  const start = from ? new Date(from) : new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() - (count - i));
    return { month: d.toISOString().slice(0, 7), ratePaise: 0 };
  });
}

function nextMonth(rows: SourcingRow[]): string {
  const last = rows[rows.length - 1]?.month;
  const d = last ? new Date(`${last}-01`) : new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

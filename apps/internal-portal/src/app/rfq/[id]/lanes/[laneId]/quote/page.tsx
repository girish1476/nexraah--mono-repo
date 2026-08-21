'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { getConfig } from '@/app/admin/apis';
import { inr, pct } from '@/lib/format';
import {
  Banner,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  useLevel,
  useToast,
} from '@/lib/ui';
import { getRfq, setBuildup } from '../../../../apis';
import { RfqLane } from '../../../../types';

/**
 * Quote build-up — `/rfq/[id]/lanes/[laneId]/quote` (part 09 §2).
 *
 *     average sourcing rate + overhead + margin = the rate quoted
 *
 * The quoted rate is derived and cannot be typed. Each component is stored so
 * a won lane can later be tested against the placement rates it actually
 * draws (BR-36, R-03).
 */
export default function QuoteBuildupPage() {
  const { id, laneId } = useParams<{ id: string; laneId: string }>();
  const router = useRouter();
  const toast = useToast();
  const level = useLevel('rfq');

  const [lane, setLane] = useState<RfqLane | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overhead, setOverhead] = useState(0);
  const [margin, setMargin] = useState(0);
  const [minimumMarginPct, setMinimumMarginPct] = useState(8);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getRfq(id), getConfig()])
      .then(([rfq, config]) => {
        const found = rfq.lanes.find((l) => l.id === laneId);
        if (!found) throw new Error('Lane not found');
        setLane(found);
        setOverhead(found.overheadPaise);
        setMargin(found.marginPaise);
        setMinimumMarginPct(config.minimum_margin_pct);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id, laneId]);

  if (error) return <ErrorState message={error} />;
  if (!lane) return <Loading what="Loading the lane" />;

  const quoted = lane.sourcingAvgPaise + overhead + margin;
  const marginPct = quoted ? (margin / quoted) * 100 : 0;
  const belowMinimum = marginPct < minimumMarginPct;

  const parts = [
    { label: 'Sourcing', value: lane.sourcingAvgPaise, colour: 'var(--color-accent-400)' },
    { label: 'Overhead', value: overhead, colour: 'var(--flag)' },
    { label: 'Margin', value: margin, colour: 'var(--mint)' },
  ];

  const save = async () => {
    setBusy(true);
    try {
      await setBuildup(id, laneId, { overheadPaise: overhead, marginPaise: margin });
      toast(`Quoted rate ${inr(quoted)}`);
      router.push(`/rfq/${id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGuard module="rfq">
      <PageHeader
        path={`/rfq/${id}/lanes/${laneId}/quote`}
        title={`${lane.origin} → ${lane.destination}`}
        sub="average sourcing + overhead + margin = the rate quoted"
        module="rfq"
      />

      <Stack>
        {belowMinimum && quoted > 0 && (
          <Banner tone="flag" title={`Margin is ${pct(marginPct)} — below the configured minimum of ${minimumMarginPct}%`}>
            The warning is dismissible, and it is recorded. Winning a lane you cannot serve profitably is a
            placement failure every week for the life of the contract.
          </Banner>
        )}

        <Panel title="Components">
          <FormGrid>
            <Field label="Average sourcing rate (₹)" hint="From the sourcing screen. Not editable here.">
              <input value={lane.sourcingAvgPaise / 100} disabled />
            </Field>
            <Field label="Overhead (₹)">
              <input
                type="number"
                value={overhead ? overhead / 100 : ''}
                disabled={level !== 'EDIT'}
                onChange={(e) => setOverhead(Number(e.target.value) * 100)}
              />
            </Field>
            <Field label="Margin (₹)">
              <input
                type="number"
                value={margin ? margin / 100 : ''}
                disabled={level !== 'EDIT'}
                onChange={(e) => setMargin(Number(e.target.value) * 100)}
              />
            </Field>
            <Field label="Quoted rate (₹)" hint="Derived. It is never keyed (BR-36).">
              <input value={quoted / 100} disabled />
            </Field>
          </FormGrid>

          <div style={{ marginTop: 18 }}>
            <div className="eyebrow">Proportions</div>
            <div
              style={{
                display: 'flex',
                height: 22,
                marginTop: 6,
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              {parts.map((p) => (
                <div
                  key={p.label}
                  title={`${p.label} ${inr(p.value)}`}
                  style={{ width: quoted ? `${(p.value / quoted) * 100}%` : '0%', background: p.colour }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11.5 }} className="muted">
              {parts.map((p) => (
                <span key={p.label}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: p.colour, marginRight: 5 }} />
                  {p.label} {inr(p.value)}
                </span>
              ))}
            </div>
          </div>

          {level === 'EDIT' && (
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={save} disabled={busy || quoted === 0}>
                Save build-up
              </button>
            </div>
          )}
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

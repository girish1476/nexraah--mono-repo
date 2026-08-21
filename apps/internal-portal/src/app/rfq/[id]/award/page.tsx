'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { fmtDate, inr } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  useLevel,
  useToast,
} from '@/lib/ui';
import { awardRfq, getRfq } from '../../apis';
import { AwardDecision, LaneOutcome, Rfq, RfqLane } from '../../types';

/**
 * Award — `/rfq/[id]/award` (part 09 §3).
 *
 * Won lanes become the client's rate card for the RFQ validity period without
 * separate re-entry. The preview below shows exactly what will be written
 * before it is written (BR-37).
 */
export default function RfqAwardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const level = useLevel('rfq');

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { outcome: LaneOutcome; awardedRupees: number }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRfq(id)
      .then((r) => {
        setRfq(r);
        setDecisions(
          Object.fromEntries(
            r.lanes.map((l) => [
              l.id,
              { outcome: (l.outcome ?? 'WON') as LaneOutcome, awardedRupees: (l.awardedRatePaise ?? l.quotedRatePaise) / 100 },
            ]),
          ),
        );
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!rfq) return <Loading what="Loading the RFQ" />;

  const won = rfq.lanes.filter((l) => decisions[l.id]?.outcome === 'WON');

  const submit = async () => {
    setBusy(true);
    try {
      const payload: AwardDecision[] = rfq.lanes.map((l) => ({
        laneId: l.id,
        outcome: decisions[l.id].outcome,
        awardedRatePaise: Math.round(decisions[l.id].awardedRupees * 100),
      }));
      const result = await awardRfq(id, payload);
      toast(`${result.rateCardLanesCreated.length} rate card lane(s) created`);
      router.push(`/rfq/${id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<RfqLane>[] = [
    { key: 'lane', label: 'Lane', render: (r) => `${r.origin} → ${r.destination}` },
    { key: 'truck', label: 'Truck type', render: (r) => r.truckType },
    { key: 'quoted', label: 'We quoted', align: 'right', render: (r) => inr(r.quotedRatePaise) },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (r) => (
        <select
          value={decisions[r.id]?.outcome ?? 'WON'}
          disabled={level !== 'EDIT'}
          style={{
            fontFamily: 'inherit',
            fontSize: 12,
            padding: '4px 6px',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-sm)',
          }}
          onChange={(e) =>
            setDecisions({ ...decisions, [r.id]: { ...decisions[r.id], outcome: e.target.value as LaneOutcome } })
          }
        >
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
          <option value="WITHDRAWN">Withdrawn</option>
        </select>
      ),
    },
    {
      key: 'awarded',
      label: 'Awarded rate (₹)',
      align: 'right',
      render: (r) => (
        <input
          type="number"
          disabled={level !== 'EDIT' || decisions[r.id]?.outcome !== 'WON'}
          value={decisions[r.id]?.awardedRupees ?? 0}
          style={{
            width: 110,
            padding: '4px 6px',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'inherit',
          }}
          onChange={(e) =>
            setDecisions({ ...decisions, [r.id]: { ...decisions[r.id], awardedRupees: Number(e.target.value) } })
          }
        />
      ),
    },
  ];

  return (
    <ModuleGuard module="rfq">
      <PageHeader
        path={`/rfq/${id}/award`}
        title="Record the award"
        sub={`${rfq.clientName} · ${fmtDate(rfq.periodFrom)} – ${fmtDate(rfq.periodTo)}`}
        module="rfq"
      />

      <Stack>
        <Panel pad={false}>
          <DataTable columns={columns} rows={rfq.lanes} rowKey={(r) => r.id} />
        </Panel>

        <Panel title="Rate card lines that will be created">
          {won.length === 0 ? (
            <span className="muted">No lanes marked won — nothing will be written.</span>
          ) : (
            <>
              <DataTable
                columns={[
                  { key: 'lane', label: 'Lane', render: (r: RfqLane) => `${r.origin} → ${r.destination}` },
                  { key: 'truck', label: 'Truck type', render: (r: RfqLane) => r.truckType },
                  {
                    key: 'rate',
                    label: 'Rate',
                    align: 'right',
                    render: (r: RfqLane) => inr(Math.round((decisions[r.id]?.awardedRupees ?? 0) * 100)),
                  },
                  { key: 'transit', label: 'Transit', align: 'right', render: (r: RfqLane) => `${r.transitDays}d` },
                  { key: 'report', label: 'Reporting', render: (r: RfqLane) => r.reportingRule.replace(/_/g, ' ').toLowerCase() },
                  { key: 'valid', label: 'Valid', render: () => `${fmtDate(rfq.periodFrom)} – ${fmtDate(rfq.periodTo)}` },
                  { key: 'prov', label: 'RFQ lane', mono: true, render: (r: RfqLane) => r.id },
                ]}
                rows={won}
                rowKey={(r) => r.id}
              />
              <Banner tone="blue" title="Every line carries its RFQ lane">
                A rate card line with no RFQ provenance cannot exist — the column is <code>NOT NULL</code>. This
                preview is exactly what gets written (BR-37).
              </Banner>
            </>
          )}
          {level === 'EDIT' && (
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={submit} disabled={busy}>
                Create rate cards
              </button>
            </div>
          )}
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

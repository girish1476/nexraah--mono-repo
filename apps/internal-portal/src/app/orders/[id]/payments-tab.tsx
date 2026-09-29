'use client';

import type { ReactNode } from 'react';
import { fmtDate, inr, inrExact } from '@/lib/format';
import { Column, DataTable, FactList, Panel, Stack, Tag } from '@/lib/ui';
import type { OrderDetail, OrderPaymentLine } from '../types';

/**
 * One row of "Money paid out".
 *
 * A row is either a bank transfer (advance, balance) — which has a UTR — or a
 * cost captured against the trip (loading, unloading), which does not. The
 * schema draws that line, not this screen: only `payments` rows carry a UTR,
 * and a trip's charge lines are costs recorded on it, never transfers of their
 * own.
 */
interface MoneyRow {
  key: string;
  what: string;
  emoji: string;
  kind: 'transfer' | 'cost';
  amountPaise: number | null;
  line: OrderPaymentLine | null;
}

/** "from ₹45,000, less ₹5,000 late penalty and ₹2,000 recovered" — only when something was taken off. */
function takenOff(line: OrderPaymentLine | null): string | null {
  if (!line || (!line.penaltyPaise && !line.deductionPaise)) return null;
  const parts: string[] = [];
  if (line.penaltyPaise) parts.push(`${inrExact(line.penaltyPaise)} late-proof penalty`);
  if (line.deductionPaise) parts.push(`${inrExact(line.deductionPaise)} recovered from earlier claims`);
  return `from ${inrExact(line.grossPaise)}, less ${parts.join(' and ')}`;
}

/**
 * The Payments tab of `/orders/[id]` — order-level accounting on one screen.
 *
 * Top: every rupee that has gone out against this order, with the UTR of each
 * transfer. Below it: what the load was bought and sold at, and the margin
 * that leaves. Releasing the advance or the balance still happens on the
 * Details tab, where those panels already live; this tab is the record of
 * what they did.
 */
export function OrderPaymentsTab({ order }: { order: OrderDetail }) {
  const p = order.payments;
  const hasTrip = order.tripId !== null;

  const rows: MoneyRow[] = [
    { key: 'advance', what: 'Advance to the transporter', emoji: '💸', kind: 'transfer', amountPaise: p.advance?.netPaise ?? null, line: p.advance },
    { key: 'loading', what: 'Loading charges', emoji: '📥', kind: 'cost', amountPaise: p.loadingPaise > 0 ? p.loadingPaise : null, line: null },
    { key: 'unloading', what: 'Unloading charges', emoji: '📤', kind: 'cost', amountPaise: p.unloadingPaise > 0 ? p.unloadingPaise : null, line: null },
    { key: 'balance', what: 'Balance to the transporter', emoji: '🏁', kind: 'transfer', amountPaise: p.balance?.netPaise ?? null, line: p.balance },
  ];

  const columns: Column<MoneyRow>[] = [
    {
      key: 'what',
      label: 'Payment',
      primary: true,
      render: (r) => (
        <>
          <span aria-hidden>{r.emoji}</span> {r.what}
        </>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (r) => (r.amountPaise !== null ? inrExact(r.amountPaise) : <span className="muted">—</span>),
      sub: (r) => takenOff(r.line),
    },
    {
      key: 'utr',
      label: 'UTR (bank reference)',
      mono: true,
      render: (r) => (r.line ? r.line.utr : <span className="muted">—</span>),
      sub: (r) => (r.line ? `${r.line.mode} · ${fmtDate(r.line.valueDate)}` : null),
    },
    {
      key: 'state',
      label: '',
      render: (r) => {
        if (r.kind === 'cost') {
          return r.amountPaise !== null ? <Tag tone="blue">Cost on this trip</Tag> : <Tag tone="grey">Not recorded yet</Tag>;
        }
        return r.line ? <Tag tone="mint">Paid</Tag> : <Tag tone="flag">Not paid yet</Tag>;
      },
    },
  ];

  const paidToTransporterPaise = (p.advance?.netPaise ?? 0) + (p.balance?.netPaise ?? 0);
  const chargesPaise = p.loadingPaise + p.unloadingPaise + p.otherChargesPaise;

  return (
    <Stack>
      <Panel title="💸 Money paid out" pad={false}>
        {hasTrip ? (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
        ) : (
          <div className="hint" style={{ padding: 15 }}>
            Nothing has been paid yet — payments start once a transporter is awarded and a trip is created for this order.
          </div>
        )}
        {hasTrip && (
          <div className="hint" style={{ padding: '10px 14px' }}>
            Paid to the transporter so far: <strong>{inrExact(paidToTransporterPaise)}</strong>. Loading and unloading
            are costs recorded against the trip rather than separate bank transfers, so they carry no UTR.
          </div>
        )}
      </Panel>

      <Panel title="📊 Rates and profit" pad={false}>
        <FactList
          facts={[
            ['Sourcing rate (vehicle placed at)', p.sourcingRatePaise !== null ? inr(p.sourcingRatePaise) : 'not awarded yet'],
            ['Placement rate (client accepted)', inr(p.placementRatePaise)],
            ...(chargesPaise > 0 ? ([['Loading, unloading and other charges', inr(chargesPaise)]] as [string, string][]) : []),
            ...(p.marginPaise !== null
              ? ([
                  [
                    'Profit margin',
                    <strong key="m" style={{ color: p.marginPaise < 0 ? 'var(--red)' : undefined }}>
                      {inr(p.marginPaise)}
                      {p.marginPct !== null ? ` · ${p.marginPct}%` : ''}
                    </strong>,
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        {p.marginPaise !== null && (
          <div className="hint" style={{ padding: '10px 14px' }}>
            Profit margin is the placement rate, less the sourcing rate, less the loading, unloading and other charges
            recorded on the trip. It is the same figure the Profit &amp; loss page uses for this load.
          </div>
        )}
      </Panel>
    </Stack>
  );
}

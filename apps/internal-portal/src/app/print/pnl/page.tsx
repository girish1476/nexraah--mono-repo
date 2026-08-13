'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { getConfig } from '@/app/admin/apis';
import { Config } from '@/app/admin/types';
import { getPnl } from '@/app/pnl/apis';
import { PnlResponse } from '@/app/pnl/types';
import { fmtDate, inrCompact, marginPct, pct } from '@/lib/format';
import { ErrorState, Loading } from '@/lib/ui';

/** Printed P&L statement — `/print/pnl` (part 10 §3). A4. */
export default function PrintPnlPage() {
  const [data, setData] = useState<PnlResponse | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getPnl({ granularity: 'MONTHLY' }), getConfig()])
      .then(([p, c]) => {
        setData(p);
        setConfig(c);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data || !config) return <Loading what="Preparing the statement" />;

  const totals = data.rows.reduce(
    (a, r) => ({ cost: a.cost + r.costPaise, revenue: a.revenue + r.revenuePaise }),
    { cost: 0, revenue: 0 },
  );

  return (
    <div style={{ background: '#fff', color: '#000', padding: 20 }}>
      <div className="no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="sheet" style={{ maxWidth: 780, margin: '0 auto', padding: 16, border: '1px solid #000' }}>
        <div style={{ borderBottom: '2px solid #000', paddingBottom: 8 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20 }}>{config.company.name}</div>
          <div style={{ fontSize: 11 }}>
            Profit and loss statement · {data.scope} · generated {fmtDate(new Date().toISOString())}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 10 }}>
          <thead>
            <tr>
              {['Period', 'Placement', 'Loading', 'Unloading', 'Detention', 'Other', 'Total cost', 'Revenue', 'Margin', '%'].map(
                (h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #000', padding: '5px 4px', fontSize: 9.5 }}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.period}>
                <td style={td}>{r.period}</td>
                <td style={tdNum}>{inrCompact(r.placementPaise)}</td>
                <td style={tdNum}>{inrCompact(r.loadingPaise)}</td>
                <td style={tdNum}>{inrCompact(r.unloadingPaise)}</td>
                <td style={tdNum}>{inrCompact(r.detentionPaise)}</td>
                <td style={tdNum}>{inrCompact(r.otherPaise)}</td>
                <td style={tdNum}>{inrCompact(r.costPaise)}</td>
                <td style={tdNum}>{inrCompact(r.revenuePaise)}</td>
                <td style={tdNum}>{inrCompact(r.marginPaise)}</td>
                <td style={tdNum}>{pct(marginPct(r.revenuePaise, r.costPaise))}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, fontWeight: 700, borderTop: '1px solid #000' }}>Total</td>
              <td colSpan={5} style={{ borderTop: '1px solid #000' }} />
              <td style={{ ...tdNum, fontWeight: 700, borderTop: '1px solid #000' }}>{inrCompact(totals.cost)}</td>
              <td style={{ ...tdNum, fontWeight: 700, borderTop: '1px solid #000' }}>{inrCompact(totals.revenue)}</td>
              <td style={{ ...tdNum, fontWeight: 700, borderTop: '1px solid #000' }}>
                {inrCompact(totals.revenue - totals.cost)}
              </td>
              <td style={{ ...tdNum, fontWeight: 700, borderTop: '1px solid #000' }}>
                {pct(marginPct(totals.revenue, totals.cost))}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ fontSize: 9.5, marginTop: 10, lineHeight: 1.45 }}>
          Cost is the placement rate paid to the transporter plus every charge booked against the load. No
          percentage overhead is allocated. Trips closed without captured charges overstate margin and are listed
          in the exception panel on screen.
        </div>
      </div>
    </div>
  );
}

const td: React.CSSProperties = { padding: '4px', borderBottom: '1px solid #ddd' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' };

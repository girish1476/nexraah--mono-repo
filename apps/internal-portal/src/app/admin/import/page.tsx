'use client';

import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime, inr } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { commit, dryRun, getImportHistory } from './apis';
import { ImportBatch, ImportSet } from './types';

const SETS: { key: ImportSet; label: string; note: string }[] = [
  {
    key: 'clients',
    label: '1 · Client master',
    note: 'Clients, agreements, credit terms and rate card lanes. Lanes are recorded against a placeholder, already-closed RFQ, so they show the same rate-card history as every other lane.',
  },
  {
    key: 'vendors',
    label: '2 · Transporter panel',
    note: 'Vendor master with KYC state, advance policy, bank details and fleet. Every imported vendor starts as Pending verification — someone still has to verify them by hand afterwards.',
  },
  {
    key: 'opening-balances',
    label: '3 · Opening balances',
    note: 'Outstanding advances, unbilled trips, open invoices and their ageing. Must reconcile to a control total supplied with the file; a mismatch aborts the whole import.',
  },
];

/** Go-live import — `/admin/import` · `config.manage` (part 12). */
export default function ImportPage() {
  const can = useCan();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [set, setSet] = useState<ImportSet>('clients');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [history, setHistory] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    getImportHistory().then(setHistory).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await dryRun(set, file);
      setBatch(result);
      toast(`Dry run complete · ${result.rows} rows read, nothing written`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const done = await commit(set, batch.id);
      toast(`Committed · ${done.rows} rows in one transaction`);
      setBatch(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!history) return <Loading what="Loading import history" />;

  const historyColumns: Column<ImportBatch>[] = [
    { key: 'set', label: 'Set', render: (r) => r.set },
    { key: 'file', label: 'File', render: (r) => r.fileName },
    { key: 'hash', label: 'File hash', mono: true, render: (r) => r.fileHash },
    { key: 'rows', label: 'Rows', align: 'right', render: (r) => r.rows },
    { key: 'rejected', label: 'Rejected', align: 'right', render: (r) => r.rejected },
    { key: 'actor', label: 'Actor', render: (r) => r.actor },
    { key: 'when', label: 'Committed', render: (r) => fmtDateTime(r.committedAt) },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Tag tone={r.status === 'COMMITTED' ? 'mint' : r.status === 'ABORTED' ? 'red' : 'grey'}>{r.status}</Tag>,
    },
  ];

  const active = SETS.find((s) => s.key === set)!;
  const totals = batch?.report?.controlTotals;
  const blockedByTotals = !!totals && !totals.reconciles;

  return (
    <ModuleGuard module="admin">
      <PageHeader path="/admin/import" title="Bulk upload" module="admin" />
      <PageIntro
        what="Load your existing vendors, clients and lanes in bulk from a spreadsheet, instead of keying them in one at a time."
        who="Administrators, usually once when going live."
      >
        Nothing is saved until you confirm. Upload the file first and you get a report of what would
        be created and what would be rejected — check that before committing.
      </PageIntro>

      <Stack>
        <Banner tone="blue" title="The sets are dependent and import in this order">
          Clients first, then the transporter panel, then opening balances. Attempting a set out of order fails
          the dry run with the missing dependency named.
        </Banner>

        <Panel title="Upload">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 1 260px' }}>
              <Field label="Set" required>
                <select value={set} onChange={(e) => setSet(e.target.value as ImportSet)} disabled={!can('config.manage')}>
                  {SETS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <Field label="CSV file" required>
                <input type="file" accept=".csv" ref={fileRef} disabled={!can('config.manage')} />
              </Field>
            </div>
            <button className="btn" onClick={upload} disabled={busy || !can('config.manage')}>
              Run dry run
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            {active.note}
          </p>
        </Panel>

        {batch?.report && (
          <Panel title="Dry-run report" right={<Tag tone="grey">Nothing has been written</Tag>}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div className="eyebrow">Rows read</div>
                <div className="stat-value">{batch.report.rowCount}</div>
              </div>
              <div>
                <div className="eyebrow">Rejected</div>
                <div className="stat-value" style={{ color: batch.rejected ? 'var(--red)' : undefined }}>
                  {batch.rejected}
                </div>
              </div>
              <div>
                <div className="eyebrow">File hash</div>
                <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>
                  {batch.fileHash}
                </div>
              </div>
            </div>

            {totals && (
              <Banner
                tone={totals.reconciles ? 'mint' : 'red'}
                title={totals.reconciles ? 'Control totals reconcile' : 'Control totals do not reconcile'}
              >
                Supplied {inr(totals.suppliedPaise)} · computed {inr(totals.computedPaise)}.
                {!totals.reconciles && ' The entire import is aborted; nothing is written.'}
              </Banner>
            )}

            {batch.report.rejects.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="eyebrow">Rejects</div>
                {batch.report.rejects.map((r) => (
                  <div key={r.row} style={{ fontSize: 12.5, padding: '4px 0' }}>
                    <span className="mono">row {r.row}</span> · {r.reason}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={doCommit} disabled={busy || blockedByTotals}>
                Confirm and commit
              </button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
                One transaction. A failure halfway leaves the database untouched.
              </span>
            </div>
          </Panel>
        )}

        <Panel title="History" pad={false}>
          <DataTable columns={historyColumns} rows={history} rowKey={(r) => r.id} empty="Nothing imported yet." />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px' }}>
            Each import is audited as a single event carrying the file hash, so a re-run of the same file is
            detectable and a bad batch is identifiable after the fact.
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}

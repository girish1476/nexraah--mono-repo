'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { cancelIndent, keepIndent, listStaleIndents } from '@/app/indents/apis';
import { StaleIndent } from '@/app/indents/types';
import { Column, DataTable, Dialog, Field, Panel, Tag, useCan, useToast } from '@/lib/ui';

/**
 * Loads nothing has happened on for a week. Operations and Leadership are put in
 * front of each one to cancel it or keep it, and are expected to settle it the
 * day it appears: a load that sits for a week is usually one the client has
 * quietly dropped, and it keeps showing as live work until somebody says so.
 *
 * Renders nothing for anyone who cannot act on it, and nothing when there is
 * nothing stale.
 */
export function StaleIndentsPanel() {
  const can = useCan();
  const toast = useToast();
  const allowed = can('indent.manage');
  const [rows, setRows] = useState<StaleIndent[]>([]);
  const [cancelling, setCancelling] = useState<StaleIndent | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!allowed) return;
    listStaleIndents()
      .then(setRows)
      .catch(() => setRows([]));
  }, [allowed]);
  useEffect(load, [load]);

  if (!allowed || rows.length === 0) return null;

  const keep = async (r: StaleIndent) => {
    setBusy(true);
    try {
      await keepIndent(r.id);
      toast(`${r.code} kept — it comes back to you if it goes another week untouched`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await cancelIndent(cancelling.id, reason.trim());
      toast(`${cancelling.code} cancelled`);
      setCancelling(null);
      setReason('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<StaleIndent>[] = [
    { key: 'code', label: 'Indent', mono: true, primary: true, render: (r) => <Link href={`/indents/${r.id}`}>{r.code}</Link>, sub: (r) => r.lane },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'stage', label: 'Where it stands', render: (r) => <Tag tone="grey">{r.stage.replace(/_/g, ' ').toLowerCase()}</Tag> },
    { key: 'idle', label: 'Quiet for', align: 'right', render: (r) => `${r.idleDays} days` },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => keep(r)}>
            Keep
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => setCancelling(r)}>
            Cancel indent
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ marginBottom: 16 }} id="stale-indents">
      <Panel title="⏳ Nothing has happened for a week — cancel or keep?" pad={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px' }}>
          Settle each of these today. Cancelling needs a remark, and the client’s side of it is what to write.
        </div>
      </Panel>

      <Dialog
        open={!!cancelling}
        title={`Cancel indent ${cancelling?.code ?? ''}`}
        body="The load is closed and any quote or trip made for it is set aside. The remark stays on its record."
        confirmLabel="Cancel indent"
        confirmDisabled={reason.trim().length < 5}
        busy={busy}
        onConfirm={cancel}
        onClose={() => setCancelling(null)}
      >
        <Field label="Remark" required hint="Why it is being cancelled — for example, the client withdrew the load.">
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}

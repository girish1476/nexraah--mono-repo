'use client';

import { useState } from 'react';
import { errorMessage } from '@/apis';
import { JOURNAL_HEADERS, journalRows } from '@/lib/accounting';
import { downloadCsv } from '@/lib/export-csv';
import { inrCompact } from '@/lib/format';
import { Field, Panel, useToast } from '@/lib/ui';
import { getJournal } from './apis';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const monthStart = () => `${today().slice(0, 8)}01`;

/**
 * Export to the accounts — the accounting-system integration (FSD B7). One
 * way: issued invoices, receipts and released payments, as a journal file the
 * accounting system imports. Nexraah is not the books of account.
 */
export function JournalExport() {
  const toast = useToast();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      const lines = await getJournal(from, to);
      if (lines.length === 0) {
        setLast('Nothing was billed, received or paid out between those days.');
        return;
      }
      downloadCsv(`nexraah-journal-${from}-to-${to}.csv`, JOURNAL_HEADERS, journalRows(lines));
      const vouchers = new Set(lines.map((l) => l.voucherNo)).size;
      const total = lines.reduce((a, l) => a + l.debitPaise, 0);
      setLast(`${vouchers} vouchers, ${lines.length} lines, ${inrCompact(total)} each side — downloaded.`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="🧾 Export to the accounts">
      <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
        Every issued invoice, every receipt and every payment released to a transporter in these days, as a journal file
        (Date, Voucher type, Voucher no, Ledger, Debit, Credit, Narration) — each voucher one debit and one equal credit.
        Import it into Tally, Zoho Books or Busy. Clients and transporters post to ledgers in their own names; the other
        two ledgers are called <strong>Freight income</strong> and <strong>Bank</strong>.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 1 180px' }}>
          <Field label="From">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: '0 1 180px' }}>
          <Field label="To">
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <button type="button" className="btn" disabled={busy || !from || !to || from > to} onClick={download}>
          {busy ? 'Preparing…' : '⬇ Download journal'}
        </button>
      </div>
      {last && (
        <p className="muted" role="status" style={{ marginBottom: 0, fontSize: 12.5 }}>
          {last}
        </p>
      )}
    </Panel>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { errorMessage } from '@/apis';
import { sessionAtom } from '@/store/atoms';
import {
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { createMarketGap, listBranches, listMarketGap, updateMarketGap } from '../apis';
import { MarketGapRow } from '../types';

type Count = 'target' | 'onPanel' | 'converted';

const BLANK = { branchId: '', fromCity: '', toCity: '', truckType: '', target: '', onPanel: '', converted: '' };

/**
 * Market gap — `/vendors/market-gap` (part 03 §3, D-19).
 *
 * A lane that draws no in-band quote is a recruitment problem, never a
 * licence to widen the band (BR-39). This screen is where that shortfall is
 * recorded and worked.
 *
 * It used to be read-only apart from the target: rows only ever came from
 * seed data, so a thin lane Operations could see on the ground had nowhere to
 * go. "Add a lane" records one, and the counts — target, trucks on the panel,
 * leads converted — can all be kept up to date in place.
 */
export default function MarketGapPage() {
  const can = useCan();
  const toast = useToast();
  const session = useAtomValue(sessionAtom);
  const [rows, setRows] = useState<MarketGapRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    listMarketGap().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const canEdit = can('vendor.edit');

  const openAdd = () => {
    setForm({ ...BLANK, branchId: session?.branch?.id ?? '' });
    setAddOpen(true);
    listBranches()
      .then((b) => setBranches(b.map((x) => ({ id: x.id, name: x.name }))))
      .catch((e) => toast(errorMessage(e)));
  };

  const add = async () => {
    setBusy(true);
    try {
      const row = await createMarketGap({
        branchId: form.branchId,
        lane: `${form.fromCity.trim()} → ${form.toCity.trim()}`,
        truckType: form.truckType.trim(),
        target: Number(form.target) || 0,
        onPanel: Number(form.onPanel) || 0,
        converted: Number(form.converted) || 0,
      });
      setRows((prev) => [...(prev ?? []), row]);
      setAddOpen(false);
      toast(`${row.lane} added to the market gap`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const countCell = (r: MarketGapRow, key: Count, label: string) =>
    canEdit ? (
      <input
        type="number"
        min={0}
        aria-label={`${label} for ${r.lane}`}
        defaultValue={r[key]}
        style={{
          width: 64,
          padding: '4px 6px',
          border: '1px solid var(--color-divider)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'inherit',
        }}
        onBlur={async (e) => {
          const value = Math.max(0, Math.floor(Number(e.target.value) || 0));
          if (value === r[key]) return;
          try {
            const updated = await updateMarketGap(r.id, { [key]: value });
            setRows((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
            toast(`${r.lane} · ${label.toLowerCase()} set to ${value}`);
          } catch (err) {
            toast(errorMessage(err));
          }
        }}
      />
    ) : (
      r[key]
    );

  const columns: Column<MarketGapRow>[] = [
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'lane', label: 'Lane under pressure', render: (r) => r.lane },
    { key: 'truck', label: 'Truck needed', render: (r) => r.truckType },
    { key: 'target', label: 'Target', align: 'right', render: (r) => countCell(r, 'target', 'Target') },
    { key: 'panel', label: 'On panel', align: 'right', render: (r) => countCell(r, 'onPanel', 'On panel') },
    { key: 'conv', label: 'Converted', align: 'right', render: (r) => countCell(r, 'converted', 'Converted') },
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

  const formValid =
    !!form.branchId && form.fromCity.trim().length >= 2 && form.toCity.trim().length >= 2 && form.truckType.trim().length >= 2 && Number(form.target) >= 0 && form.target !== '';

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/market-gap"
        title="Market gap"
        sub="Where the panel is thin. A repeat placement failure on a lane belongs here, not in a wider band."
        module="vendors"
        right={
          canEdit ? (
            <button className="btn" onClick={openAdd}>
              ➕ Add a lane
            </button>
          ) : undefined
        }
      />
      <Stack>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading market gap" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              empty={canEdit ? 'No gap recorded yet — use “Add a lane” to record one.' : 'No gap recorded.'}
            />
          </Panel>
        )}
      </Stack>

      <Dialog
        open={addOpen}
        title="Add a lane to the market gap"
        body="A lane where there are not enough transporters on the panel. Record how many trucks you need, how many you already have, and how many leads have been converted."
        confirmLabel="Add lane"
        confirmDisabled={!formValid}
        busy={busy}
        onConfirm={add}
        onClose={() => setAddOpen(false)}
      >
        <FormGrid>
          <Field label="Branch" required>
            <select
              value={form.branchId}
              disabled={!!session?.branch}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              <option value="">Choose a branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Truck type" required>
            <input placeholder="e.g. 32 ft SXL" value={form.truckType} onChange={(e) => setForm({ ...form, truckType: e.target.value })} />
          </Field>
          <Field label="From city" required>
            <input value={form.fromCity} onChange={(e) => setForm({ ...form, fromCity: e.target.value })} />
          </Field>
          <Field label="To city" required>
            <input value={form.toCity} onChange={(e) => setForm({ ...form, toCity: e.target.value })} />
          </Field>
          <Field label="Target (trucks needed)" required>
            <input type="number" min={0} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </Field>
          <Field label="On panel now">
            <input type="number" min={0} value={form.onPanel} onChange={(e) => setForm({ ...form, onPanel: e.target.value })} />
          </Field>
          <Field label="Leads converted">
            <input type="number" min={0} value={form.converted} onChange={(e) => setForm({ ...form, converted: e.target.value })} />
          </Field>
        </FormGrid>
      </Dialog>
    </ModuleGuard>
  );
}

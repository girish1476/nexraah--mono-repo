'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  useCan,
  useToast,
} from '@/lib/ui';
import { createBranch, listBranches, updateBranch } from './apis';
import { Branch, SUPPLY_SOURCE_LABEL, SUPPLY_SOURCES, SupplySource } from './types';

/** "Achuthapuram, anakapalli ," → the towns, trimmed, blanks dropped. */
function townsFrom(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim().replace(/s+/g, ' '))
    .filter(Boolean);
}

/**
 * Branches — `/admin/branches` · `config.manage`.
 *
 * Every branch selector across the console (vendor onboarding, indent
 * intake) reads this list, so opening a branch here makes it available
 * everywhere immediately.
 *
 * "Also serves" is the list a load's branch is found from: a pickup in one of
 * those towns belongs to this branch (BR-20). Without it only the branch's own
 * city matched, and a load from a nearby town could not be raised at all.
 *
 * Supply source is edited in place rather than behind a dialog: it is the one
 * field an operator revises as the market changes under them, and a branch
 * manager reviewing a whole region should be able to correct four rows
 * without opening four dialogs.
 */
export default function BranchesPage() {
  const can = useCan();
  const toast = useToast();
  const editable = can('config.manage');

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [catchmentKm, setCatchmentKm] = useState(150);
  const [servedCities, setServedCities] = useState('');
  const [supplySource, setSupplySource] = useState<SupplySource | ''>('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listBranches().then(setBranches).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const patchRow = async (row: Branch, patch: Partial<Branch>) => {
    setSaving(row.id);
    try {
      const updated = await updateBranch(row.id, {
        supplySource: patch.supplySource,
        supplyRemarks: patch.supplyRemarks,
        servedCities: patch.servedCities,
      });
      setBranches((prev) => prev?.map((b) => (b.id === updated.id ? updated : b)) ?? null);
      // Edits save on leaving the field, so say so — otherwise nothing shows it worked.
      toast(`${updated.name} saved`);
    } catch (e) {
      toast(errorMessage(e));
      load();
    } finally {
      setSaving(null);
    }
  };

  const onCreate = async () => {
    if (!name.trim() || !city.trim()) return;
    setBusy(true);
    try {
      await createBranch({
        name: name.trim(),
        city: city.trim(),
        catchmentKm,
        servedCities: townsFrom(servedCities),
        supplySource: supplySource || undefined,
      });
      toast(`${name.trim()} added · available in every branch selector`);
      setOpen(false);
      setName('');
      setCity('');
      setCatchmentKm(150);
      setServedCities('');
      setSupplySource('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Branch>[] = [
    { key: 'code', label: 'Code', mono: true, render: (r) => r.code },
    { key: 'name', label: 'Name', render: (r) => r.name },
    { key: 'city', label: 'City', render: (r) => r.city },
    {
      key: 'servedCities',
      label: 'Also serves',
      render: (r) => {
        const towns = r.servedCities ?? [];
        return editable ? (
          <input
            key={towns.join(',')}
            defaultValue={towns.join(', ')}
            disabled={saving === r.id}
            placeholder="e.g. Achuthapuram, Anakapalli"
            aria-label={`Towns ${r.name} also serves`}
            title="Towns, separated by commas. A load picked up in one of them belongs to this branch."
            onBlur={(e) => {
              const next = townsFrom(e.target.value);
              if (next.join(',') !== towns.join(',')) patchRow(r, { servedCities: next });
            }}
          />
        ) : (
          towns.join(', ') || '—'
        );
      },
    },
    { key: 'catchment', label: 'Catchment (km)', align: 'right', render: (r) => r.catchmentKm },
    {
      key: 'supplySource',
      label: 'Where vehicles come from',
      render: (r) =>
        editable ? (
          <select
            value={r.supplySource ?? ''}
            disabled={saving === r.id}
            onChange={(e) =>
              patchRow(r, { supplySource: (e.target.value || null) as SupplySource | null })
            }
            aria-label={`Supply source for ${r.name}`}
          >
            <option value="">Not recorded</option>
            {SUPPLY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SUPPLY_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        ) : (
          (r.supplySourceLabel ?? 'Not recorded')
        ),
    },
    {
      key: 'supplyRemarks',
      label: 'Remarks',
      render: (r) =>
        editable ? (
          <input
            defaultValue={r.supplyRemarks ?? ''}
            disabled={saving === r.id}
            placeholder="e.g. union only in cane season"
            aria-label={`Supply remarks for ${r.name}`}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (r.supplyRemarks ?? '')) patchRow(r, { supplyRemarks: next || null });
            }}
          />
        ) : (
          (r.supplyRemarks ?? '—')
        ),
    },
  ];

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin/branches"
        title="Branches"
        sub="Your offices, the towns each one covers, and where each one finds trucks. A load belongs to the branch whose city, or one of whose &quot;Also serves&quot; towns, is its pickup city."
        module="admin"
        right={
          editable && (
            <button className="btn" onClick={() => setOpen(true)}>
              Add branch
            </button>
          )
        }
      />

      {error && <ErrorState message={error} retry={load} />}
      {!branches && !error && <Loading what="Loading branches" />}
      {branches && (
        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={branches}
            rowKey={(r) => r.id}
            empty="No branch on file. Add your first one to make it selectable during vendor onboarding and indent intake."
          />
        </Panel>
      )}

      <Dialog
        open={open}
        title="Add a branch"
        body="Available in every branch selector as soon as it's saved — including vendor onboarding."
        confirmLabel="Add branch"
        confirmDisabled={!name.trim() || !city.trim()}
        busy={busy}
        onConfirm={onCreate}
        onClose={() => setOpen(false)}
      >
        <Field label="Branch name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Visakhapatnam (HO)" />
        </Field>
        <Field label="City" required>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Visakhapatnam" />
        </Field>
        <Field
          label="Also serves"
          hint="Nearby towns this branch covers, separated by commas. A load picked up in one of them belongs to this branch."
        >
          <input
            value={servedCities}
            onChange={(e) => setServedCities(e.target.value)}
            placeholder="e.g. Achuthapuram, Anakapalli"
          />
        </Field>
        <Field
          label="Catchment (km)"
          hint="How far out this branch reaches. Used to work out which branch a vendor belongs to from their base city."
        >
          <input
            type="number"
            value={catchmentKm}
            onChange={(e) => setCatchmentKm(Number(e.target.value) || 0)}
          />
        </Field>
        <Field
          label="Where vehicles come from"
          hint="Leave blank if you're not sure yet — you can set it later from the list."
        >
          <select value={supplySource} onChange={(e) => setSupplySource(e.target.value as SupplySource | '')}>
            <option value="">Not recorded</option>
            {SUPPLY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SUPPLY_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

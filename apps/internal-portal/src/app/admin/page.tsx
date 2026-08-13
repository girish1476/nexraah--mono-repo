'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { DOC_LABELS } from '@/lib/documents';
import { inr } from '@/lib/format';
import {
  Column,
  DataTable,
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
import { getConfig, getNumberSeries, patchConfig, patchNumberSeries } from './apis';
import { Config, NumberSeries } from './types';

/**
 * Control panel — `/admin` · `config.manage`.
 *
 * There is deliberately no GST rate or charge-mechanism setting: reverse
 * charge is permanent for this entity (D-26) and a configurable rate would
 * imply otherwise (part 01 §4).
 */
export default function ControlPanelPage() {
  const can = useCan();
  const toast = useToast();
  const editable = can('config.manage');

  const [config, setConfig] = useState<Config | null>(null);
  const [series, setSeries] = useState<NumberSeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([getConfig(), getNumberSeries()])
      .then(([c, s]) => {
        setConfig(c);
        setSeries(s);
      })
      .catch((e) => setError(errorMessage(e)));
  };

  useEffect(load, []);

  const save = async (patch: Partial<Config>) => {
    setSaving(true);
    try {
      setConfig(await patchConfig(patch));
      toast('Configuration saved · audited');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleAdvanceDoc = (kind: string) => {
    if (!config) return;
    const set = config.advance_document_set.includes(kind)
      ? config.advance_document_set.filter((k) => k !== kind)
      : [...config.advance_document_set, kind];
    save({ advance_document_set: set });
  };

  const seriesColumns: Column<NumberSeries>[] = [
    { key: 'key', label: 'Series', render: (r) => r.key.replace(/_/g, ' ') },
    { key: 'prefix', label: 'Prefix', render: (r) => <span className="mono">{r.prefix}</span> },
    {
      key: 'sample',
      label: 'Next number',
      render: (r) => (
        <span className="mono">{`${r.prefix}${String(r.nextValue).padStart(r.width, '0')}`}</span>
      ),
    },
    { key: 'width', label: 'Width', align: 'right', render: (r) => r.width },
    { key: 'scope', label: 'Scope', render: (r) => <Tag tone="grey">{r.scope}</Tag> },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        editable ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              const value = window.prompt(`Next value for ${r.key}`, String(r.nextValue));
              if (!value) return;
              try {
                const updated = await patchNumberSeries(r.key, { nextValue: Number(value) });
                setSeries((rows) => rows.map((row) => (row.key === r.key ? updated : row)));
                toast(`${r.key} updated`);
              } catch (e) {
                toast(errorMessage(e));
              }
            }}
          >
            Edit
          </button>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin"
        title="Control panel"
        sub="Every setting here is audited. Numbering is gap-free under concurrent use (NFR-08)."
        module="admin"
      />

      {error && <ErrorState message={error} retry={load} />}
      {!config && !error && <Loading what="Loading configuration" />}

      {config && (
        <Stack>
          <Panel title="Modules">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {Object.entries(config.modules).map(([key, on]) => (
                <label key={key} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!editable || saving}
                    onChange={() => save({ modules: { ...config.modules, [key]: !on } })}
                  />
                  {key}
                </label>
              ))}
            </div>
          </Panel>

          <Panel
            title="Advance document set"
            right={<span className="muted" style={{ fontSize: 11.5 }}>BR-58 · read by the advance gate</span>}
          >
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Removing a document from this set is an audited configuration change. The payment gate reads this
              list, so a removal releases money that was previously held.
            </p>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {Object.keys(DOC_LABELS)
                .filter((k) => !['LR', 'POD'].includes(k))
                .map((kind) => (
                  <label key={kind} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={config.advance_document_set.includes(kind)}
                      disabled={!editable || saving}
                      onChange={() => toggleAdvanceDoc(kind)}
                    />
                    {DOC_LABELS[kind]}
                  </label>
                ))}
            </div>
          </Panel>

          <Panel title="Settings">
            <FormGrid>
              <NumberSetting label="Advance default %" value={config.advance_default_pct} k="advance_default_pct" save={save} editable={editable} />
              <NumberSetting label="Credit default days" value={config.credit_default_days} k="credit_default_days" save={save} editable={editable} />
              <NumberSetting label="SLA hours" value={config.sla_hours} k="sla_hours" save={save} editable={editable} />
              <NumberSetting label="POD turnaround days (BR-12)" value={config.pod_tat_days} k="pod_tat_days" save={save} editable={editable} />
              <NumberSetting
                label={`POD penalty per day — ${inr(config.pod_penalty_per_day_paise)}`}
                value={config.pod_penalty_per_day_paise}
                k="pod_penalty_per_day_paise"
                save={save}
                editable={editable}
                hint="Paise. BR-24 — accrues from day 21 on actuals."
              />
              <NumberSetting label="POD forfeit days (BR-25)" value={config.pod_forfeit_days} k="pod_forfeit_days" save={save} editable={editable} />
              <NumberSetting label="E-way warning window (hours)" value={config.eway_warning_window_hours} k="eway_warning_window_hours" save={save} editable={editable} />
              <NumberSetting label="Overspeed (km/h)" value={config.overspeed_kmph} k="overspeed_kmph" save={save} editable={editable} />
              <NumberSetting label="Long halt (minutes)" value={config.halt_minutes} k="halt_minutes" save={save} editable={editable} />
              <NumberSetting label="Dark vehicle interval (minutes)" value={config.dark_vehicle_interval_minutes} k="dark_vehicle_interval_minutes" save={save} editable={editable} />
              <NumberSetting label="Minimum margin %" value={config.minimum_margin_pct} k="minimum_margin_pct" save={save} editable={editable} />
              <NumberSetting label="Branch catchment (km, BR-34)" value={config.branch_catchment_km} k="branch_catchment_km" save={save} editable={editable} />
            </FormGrid>
          </Panel>

          <Panel title="Company details" right={<span className="muted" style={{ fontSize: 11.5 }}>printed on every document</span>}>
            <FormGrid>
              {(Object.keys(config.company) as (keyof Config['company'])[]).map((key) => (
                <Field key={key} label={key.toUpperCase()}>
                  <input
                    defaultValue={config.company[key]}
                    disabled={!editable}
                    onBlur={(e) =>
                      e.target.value !== config.company[key] &&
                      save({ company: { ...config.company, [key]: e.target.value } })
                    }
                  />
                </Field>
              ))}
            </FormGrid>
          </Panel>

          <Panel title="Numbering series" pad={false}>
            <DataTable columns={seriesColumns} rows={series} rowKey={(r) => r.key} />
          </Panel>
        </Stack>
      )}
    </ModuleGuard>
  );
}

function NumberSetting({
  label,
  value,
  k,
  save,
  editable,
  hint,
}: {
  label: string;
  value: number;
  k: keyof Config;
  save: (patch: Partial<Config>) => void;
  editable: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        defaultValue={value}
        disabled={!editable}
        onBlur={(e) => Number(e.target.value) !== value && save({ [k]: Number(e.target.value) } as Partial<Config>)}
      />
    </Field>
  );
}

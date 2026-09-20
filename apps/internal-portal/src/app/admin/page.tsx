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
  PageIntro,
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
/** Screen labels for the module switches — the stored keys are internal names. */
const MODULE_LABELS: Record<string, { label: string; hint: string }> = {
  rfq: {
    label: 'Rate enquiries (RFQ)',
    hint: 'Turning this off removes Rate enquiries from every role’s menu, immediately.',
  },
  telematics: {
    label: 'Vehicle tracking',
    hint: 'Turning this off removes the Fleet board and its alerts from every role’s menu, immediately.',
  },
  invoicing: {
    label: 'Invoicing',
    hint: 'Turning this off removes Invoices from every role’s menu, immediately.',
  },
  import: {
    label: 'Bulk data import',
    hint: 'Turning this off removes the spreadsheet upload tools from every role’s menu, immediately.',
  },
};

/** Screen labels for the company detail fields — the stored keys are internal names. */
const COMPANY_LABELS: Record<string, string> = {
  name: 'Company name',
  address: 'Registered address',
  bank: 'Bank details',
  sac: 'SAC code',
  signatory: 'Signatory (name printed under the signature line)',
};

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
      <PageHeader path="/admin" title="Settings" module="admin" />
      <PageIntro
        what="The company-wide settings every screen obeys — which modules are switched on, what documents an advance needs, how long a transporter has to send proof of delivery, and what it costs them if they don't."
        who="Administrators only."
      >
        A change here applies to everyone immediately, and every change is recorded against your
        name. Document numbers are never skipped or reused, even when several people are working at
        once.
      </PageIntro>

      {error && <ErrorState message={error} retry={load} />}
      {!config && !error && <Loading what="Loading configuration" />}

      {config && (
        <Stack>
          <Panel title="Modules">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Turning a module off removes it from every role&apos;s menu straight away, for everyone.
            </p>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {Object.entries(config.modules).map(([key, on]) => (
                <label key={key} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    /* Keyed on the config key, not the wording. The label now
                       carries a plain-language name and a sentence of hint
                       beneath it, so there is no short accessible name left to
                       find this control by — and the key is the thing that
                       actually identifies the module anyway. */
                    data-testid={`module-${key}`}
                    checked={on}
                    disabled={!editable || saving}
                    onChange={() => save({ modules: { ...config.modules, [key]: !on } })}
                  />
                  <span>
                    {MODULE_LABELS[key]?.label ?? key}
                    {MODULE_LABELS[key] && (
                      <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                        {MODULE_LABELS[key].hint}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </Panel>

          <Panel
            title="Advance document set"
            right={<span className="muted" style={{ fontSize: 11.5 }}>checked before any advance is released</span>}
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
              <NumberSetting label="POD turnaround days" value={config.pod_tat_days} k="pod_tat_days" save={save} editable={editable} hint="Days a transporter has to return proof of delivery (POD) after a trip ends." />
              <NumberSetting
                label={`POD penalty per day — ${inr(config.pod_penalty_per_day_paise)}`}
                value={config.pod_penalty_per_day_paise}
                k="pod_penalty_per_day_paise"
                save={save}
                editable={editable}
                hint={`In paise. Starts the day after the ${config.pod_tat_days}-day window above expires.`}
              />
              <NumberSetting label="POD forfeit days" value={config.pod_forfeit_days} k="pod_forfeit_days" save={save} editable={editable} hint="After this many days without proof of delivery, the balance is forfeited altogether." />
              <NumberSetting label="E-way warning window (hours)" value={config.eway_warning_window_hours} k="eway_warning_window_hours" save={save} editable={editable} />
              <NumberSetting label="Overspeed (km/h)" value={config.overspeed_kmph} k="overspeed_kmph" save={save} editable={editable} />
              <NumberSetting label="Long halt (minutes)" value={config.halt_minutes} k="halt_minutes" save={save} editable={editable} />
              <NumberSetting label="No-signal alert after (minutes)" value={config.dark_vehicle_interval_minutes} k="dark_vehicle_interval_minutes" save={save} editable={editable} />
              <NumberSetting label="Minimum margin %" value={config.minimum_margin_pct} k="minimum_margin_pct" save={save} editable={editable} />
              <NumberSetting
                label="Default catchment for new branches (km)"
                value={config.branch_catchment_km}
                k="branch_catchment_km"
                save={save}
                editable={editable}
                hint="Used only until a branch sets its own — edit an individual branch's catchment from Branches."
              />
            </FormGrid>
          </Panel>

          <Panel title="Company details" right={<span className="muted" style={{ fontSize: 11.5 }}>printed on every document</span>}>
            <FormGrid>
              {(Object.keys(config.company) as (keyof Config['company'])[]).map((key) => (
                <Field key={key} label={COMPANY_LABELS[key] ?? key.toUpperCase()}>
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

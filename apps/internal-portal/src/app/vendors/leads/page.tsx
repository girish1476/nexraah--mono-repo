'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  CityField,
  Column,
  DataTable,
  Dialog,
  EmptyState,
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
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { createLead, listLeads, updateLead } from '../apis';
import { Lead } from '../types';

const STAGES: Lead['stage'][] = ['NEW', 'CONTACTED', 'DOCUMENTS_REQUESTED', 'QUALIFIED', 'CONVERTED', 'DROPPED'];

const STAGE_TONE: Record<Lead['stage'], Tone> = {
  NEW: 'grey',
  CONTACTED: 'blue',
  DOCUMENTS_REQUESTED: 'flag',
  QUALIFIED: 'mint',
  CONVERTED: 'mint',
  DROPPED: 'red',
};

/**
 * Where a lead came from, in the words someone would say out loud. The stored
 * values stay the enum the server and the fixtures already use; only the
 * reading changes — nobody should have to decode MARKET_GAP on a screen.
 */
const SOURCES: { value: string; label: string }[] = [
  { value: 'FIELD', label: 'Met in the field' },
  { value: 'REFERRAL', label: 'Referred to us' },
  { value: 'MARKET_GAP', label: 'A lane we cannot cover' },
  { value: 'INBOUND', label: 'They called us' },
];

function sourceLabel(source: string): string {
  return SOURCES.find((s) => s.value === source)?.label ?? source.replace(/_/g, ' ').toLowerCase();
}

/** OWNER/VENDOR is a distinction about trucks, so say it in trucks. */
const PARTY_LABEL: Record<Lead['partyType'], string> = {
  OWNER: 'owns their trucks',
  VENDOR: 'arranges trucks',
};

/** Ten digits, Indian mobile — the same rule the onboarding wizard applies. */
const PHONE_RE = /^[6-9]\d{9}$/;

interface LeadForm {
  name: string;
  city: string;
  phone: string;
  partyType: Lead['partyType'];
  source: string;
  trucksClaimed: string;
  notes: string;
}

const BLANK_LEAD: LeadForm = {
  name: '',
  city: '',
  phone: '',
  partyType: 'VENDOR',
  source: 'FIELD',
  trucksClaimed: '',
  notes: '',
};

/** Leads — `/vendors/leads` (part 03 §3). The pipeline that feeds onboarding. */
export default function LeadsPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<LeadForm>(BLANK_LEAD);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError(null);
    listLeads().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const move = async (lead: Lead, stage: Lead['stage']) => {
    try {
      const updated = await updateLead(lead.id, { stage });
      setRows((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));
      toast(`${lead.name} → ${stage.replace(/_/g, ' ').toLowerCase()}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const set = (patch: Partial<LeadForm>) => setForm((f) => ({ ...f, ...patch }));

  const openAdd = () => {
    setForm(BLANK_LEAD);
    setAdding(true);
  };

  const phoneTyped = form.phone.trim().length > 0;
  const phoneOk = PHONE_RE.test(form.phone.trim());
  const readyToSave = form.name.trim().length > 1 && form.city.trim().length > 1 && phoneOk;

  /**
   * `code` and `stage` are deliberately not sent. The server hands out the
   * lead number, and every new lead starts at NEW — the same rule as every
   * other record in the console.
   */
  const saveLead = async () => {
    setSaving(true);
    try {
      const created = await createLead({
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        partyType: form.partyType,
        source: form.source,
        trucksClaimed: Number(form.trucksClaimed) || 0,
        notes: form.notes.trim(),
      });
      setRows((prev) => [created, ...(prev ?? [])]);
      setAdding(false);
      setForm(BLANK_LEAD);
      toast(`${created.name} added — nobody has spoken to them yet`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const addButton = can('vendor.edit') ? (
    <button className="btn" onClick={openAdd}>
      ➕ Add a lead
    </button>
  ) : null;

  const columns: Column<Lead>[] = [
    { key: 'code', label: 'Lead', mono: true, render: (r) => r.code },
    {
      key: 'name',
      label: 'Name',
      render: (r) => (
        <div>
          <div>{r.name}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {r.city} · {PARTY_LABEL[r.partyType]}
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', mono: true, render: (r) => r.phone },
    { key: 'trucks', label: 'Trucks claimed', align: 'right', render: (r) => r.trucksClaimed },
    {
      key: 'source',
      label: 'Where they came from',
      render: (r) => <Tag tone="grey">{sourceLabel(r.source)}</Tag>,
    },
    {
      key: 'stage',
      label: 'Stage',
      render: (r) =>
        can('vendor.edit') ? (
          <select
            value={r.stage}
            onChange={(e) => move(r, e.target.value as Lead['stage'])}
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '4px 6px',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        ) : (
          <Tag tone={STAGE_TONE[r.stage]}>{r.stage.replace(/_/g, ' ')}</Tag>
        ),
    },
    { key: 'notes', label: 'Notes', render: (r) => <span className="muted">{r.notes || '—'}</span> },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => {
        // A converted lead used to end here as a dead row — it said something
        // had happened but never what, and the next question is always "so
        // which transporter is that?". The answer rides in on the list
        // itself, so it is named here and linked to.
        //
        // Guarded on the link rather than on the stage: the id is the fact,
        // the stage is only a word next to it.
        if (r.convertedVendorId) {
          return (
            <Link href={`/vendors/${r.convertedVendorId}`} style={{ textDecoration: 'none' }}>
              <Tag tone="mint" emoji="🚛">
                Now a transporter:{' '}
                {r.convertedVendorName ?? r.convertedVendorCode ?? 'open their file'}
              </Tag>
            </Link>
          );
        }
        if (r.stage === 'QUALIFIED' && can('vendor.edit')) {
          // Carries the lead through, so the wizard can fill itself in and
          // the server can close this row off when the vendor file is created.
          return (
            <Link href={`/vendors/new?lead=${r.id}`} className="btn btn-sm">
              Start onboarding
            </Link>
          );
        }
        return null;
      },
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/leads"
        title="Leads"
        sub="New → Contacted → Documents requested → Qualified → Converted"
        module="vendors"
        right={addButton}
      />
      <PageIntro
        what="Transporters we have met or been referred to, but have not put on the panel yet. Move one along as you speak to them; once they are qualified, start onboarding from here."
        who="Business development and branch teams use this."
      />
      <Stack>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading leads" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  emoji="🤝"
                  title="No transporters are in the pipeline yet"
                  hint="Every transporter on the panel started as a lead. When someone meets one, or a referral comes in, add them here — then work them along until they are ready to onboard."
                  action={addButton}
                />
              }
            />
          </Panel>
        )}
      </Stack>

      <Dialog
        open={adding}
        title="➕ Add a lead"
        body="A transporter somebody met or was referred to. Only what you already know — the rest can be filled in as you speak to them."
        confirmLabel="Add lead"
        confirmDisabled={!readyToSave}
        busy={saving}
        onConfirm={saveLead}
        onClose={() => setAdding(false)}
      >
        <FormGrid>
          <Field label="What are they called?" required>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Deshpande Carriers"
            />
          </Field>
          <Field label="Where are they based?" required>
            <CityField
              listId="cities-new-lead"
              value={form.city}
              onChange={(e) => set({ city: e.target.value })}
              placeholder="Nashik"
            />
          </Field>
          <Field
            label="What number do we call?"
            required
            hint={phoneTyped && !phoneOk ? undefined : 'Ten digits, Indian mobile.'}
            error={phoneTyped && !phoneOk ? 'Ten digits, Indian mobile — no country code.' : undefined}
          >
            <input
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              inputMode="numeric"
              placeholder="9822011234"
            />
          </Field>
          <Field label="Do they own the trucks, or arrange them?" required>
            <select
              value={form.partyType}
              onChange={(e) => set({ partyType: e.target.value as Lead['partyType'] })}
            >
              <option value="OWNER">They own their own trucks</option>
              <option value="VENDOR">They arrange trucks from others</option>
            </select>
          </Field>
          <Field label="Who told us about them?" required>
            <select value={form.source} onChange={(e) => set({ source: e.target.value })}>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="How many trucks do they say they have?"
            hint="Their own claim, not something we have checked yet."
          >
            <input
              type="number"
              min={0}
              value={form.trucksClaimed}
              onChange={(e) => set({ trucksClaimed: e.target.value })}
              placeholder="4"
            />
          </Field>
        </FormGrid>
        <Field
          label="Anything else worth remembering?"
          hint="The lanes they run, who introduced you, what they asked for — whatever the next person needs."
        >
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Runs Nashik → Nagpur weekly."
          />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

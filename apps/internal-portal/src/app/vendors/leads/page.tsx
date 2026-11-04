'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
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
import { createLead, listLeads, listVendors, updateLead } from '../apis';
import { LEAD_SOURCES, leadSourceLabel } from '../lead-labels';
import { Lead, VendorListRow } from '../types';

const STAGES: Lead['stage'][] = ['NEW', 'CONTACTED', 'DOCUMENTS_REQUESTED', 'QUALIFIED', 'CONVERTED', 'DROPPED'];

const STAGE_TONE: Record<Lead['stage'], Tone> = {
  NEW: 'grey',
  CONTACTED: 'blue',
  DOCUMENTS_REQUESTED: 'flag',
  QUALIFIED: 'mint',
  CONVERTED: 'mint',
  DROPPED: 'red',
};


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

function formOf(lead: Lead): LeadForm {
  return {
    name: lead.name ?? '',
    city: lead.city ?? '',
    phone: lead.phone ?? '',
    partyType: lead.partyType ?? 'VENDOR',
    source: lead.source ?? 'FIELD',
    trucksClaimed: lead.trucksClaimed ? String(lead.trucksClaimed) : '',
    notes: lead.notes ?? '',
  };
}

const stageLabel = (stage: Lead['stage']) => stage.replace(/_/g, ' ').toLowerCase();

/** The fields a lead is added with, and edited with afterwards. */
function LeadFields({ form, set, listId }: { form: LeadForm; set: (patch: Partial<LeadForm>) => void; listId: string }) {
  const phoneTyped = form.phone.trim().length > 0;
  const phoneOk = PHONE_RE.test(form.phone.trim());
  return (
    <>
      <FormGrid>
        <Field label="What are they called?" required>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Deshpande Carriers" />
        </Field>
        <Field label="Where are they based?" required>
          <CityField
            listId={listId}
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
          <select value={form.partyType} onChange={(e) => set({ partyType: e.target.value as Lead['partyType'] })}>
            <option value="OWNER">They own their own trucks</option>
            <option value="VENDOR">They arrange trucks from others</option>
          </select>
        </Field>
        <Field label="Who told us about them?" required>
          <select value={form.source} onChange={(e) => set({ source: e.target.value })}>
            {LEAD_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="How many trucks do they say they have?" hint="Their own claim, not something we have checked yet.">
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
    </>
  );
}

/** Leads — `/vendors/leads` (part 03 §3). The pipeline that feeds onboarding. */
export default function LeadsPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<LeadForm>(BLANK_LEAD);
  const [saving, setSaving] = useState(false);
  /** The lead open in the details dialog, and what has been typed over it. */
  const [open, setOpen] = useState<Lead | null>(null);
  const [linkTo, setLinkTo] = useState('');
  const [vendors, setVendors] = useState<VendorListRow[] | null>(null);

  const load = () => {
    setError(null);
    listLeads()
      .then((leads) => {
        setRows(leads);
        // `/vendors/leads?lead=…` — a transporter's file links back to the
        // lead it came from, and lands with that lead open.
        const wanted = new URLSearchParams(window.location.search).get('lead');
        const found = wanted ? leads.find((l) => l.id === wanted) : undefined;
        if (found) openLead(found);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const replace = (updated: Lead) => setRows((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));

  const move = async (lead: Lead, stage: Lead['stage']) => {
    try {
      replace(await updateLead(lead.id, { stage }));
      toast(`${lead.name} → ${stageLabel(stage)}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const set = (patch: Partial<LeadForm>) => setForm((f) => ({ ...f, ...patch }));

  const openAdd = () => {
    setForm(BLANK_LEAD);
    setAdding(true);
  };

  const openLead = (lead: Lead) => {
    setForm(formOf(lead));
    setLinkTo('');
    setOpen(lead);
    // Only needed to link a transporter, so only fetched for a lead that has none.
    if (!lead.convertedVendorId && !vendors) listVendors().then(setVendors).catch(() => setVendors([]));
  };

  const phoneOk = PHONE_RE.test(form.phone.trim());
  const readyToSave = form.name.trim().length > 1 && form.city.trim().length > 1 && phoneOk;

  const saveEdit = async () => {
    if (!open) return;
    setSaving(true);
    try {
      const updated = await updateLead(open.id, {
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        partyType: form.partyType,
        source: form.source,
        trucksClaimed: Number(form.trucksClaimed) || 0,
        notes: form.notes.trim(),
        ...(linkTo ? { convertedVendorId: linkTo } : {}),
      });
      replace(updated);
      setOpen(null);
      toast(
        linkTo
          ? `${updated.name} is linked to ${updated.convertedVendorName ?? 'their transporter file'}`
          : `${updated.name} saved`,
      );
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // A transporter can only have come from one lead.
  const linkable = (vendors ?? []).filter((v) => !(rows ?? []).some((r) => r.convertedVendorId === v.id));

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
          <button
            type="button"
            onClick={() => openLead(r)}
            style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer', textAlign: 'left' }}
          >
            {r.name}
          </button>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {r.city} · {PARTY_LABEL[r.partyType] ?? '—'}
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', mono: true, render: (r) => r.phone },
    { key: 'trucks', label: 'Trucks claimed', align: 'right', render: (r) => r.trucksClaimed },
    {
      key: 'source',
      label: 'Where they came from',
      render: (r) => <Tag tone="grey">{leadSourceLabel(r.source)}</Tag>,
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
              // Converted comes from onboarding or linking the transporter —
              // picked here, it would point at nothing.
              <option key={s} value={s} disabled={s === 'CONVERTED' && !r.convertedVendorId}>
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
        const edit = (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openLead(r)}>
            {can('vendor.edit') ? '✏️ Edit' : 'View'}
          </button>
        );
        if (r.convertedVendorId) {
          return (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
              <Link href={`/vendors/${r.convertedVendorId}`} style={{ textDecoration: 'none' }}>
                <Tag tone="mint" emoji="🚛">
                  Now a transporter:{' '}
                  {r.convertedVendorName ?? r.convertedVendorCode ?? 'open their file'}
                </Tag>
              </Link>
              {edit}
            </div>
          );
        }
        // A lead marked Converted by hand before that was refused has no
        // transporter behind it; it can still be onboarded, or linked.
        if ((r.stage === 'QUALIFIED' || r.stage === 'CONVERTED') && can('vendor.edit')) {
          // Carries the lead through, so the wizard can fill itself in and
          // the server can close this row off when the vendor file is created.
          return (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Link href={`/vendors/new?lead=${r.id}`} className="btn btn-sm">
                Start onboarding
              </Link>
              {edit}
            </div>
          );
        }
        return edit;
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
        <LeadFields form={form} set={set} listId="cities-new-lead" />
      </Dialog>

      {open && (
        <Dialog
          open
          width={560}
          title={`${open.code} · ${open.name}`}
          body={
            can('vendor.edit')
              ? 'Everything we know about this lead. Change anything that was keyed in wrong, or has changed since.'
              : 'Everything we know about this lead.'
          }
          facts={[
            ['Stage', <Tag key="s" tone={STAGE_TONE[open.stage]}>{stageLabel(open.stage)}</Tag>],
            ...(can('vendor.edit')
              ? []
              : ([
                  ['Based in', open.city || '—'],
                  ['Phone', open.phone || '—'],
                  ['Trucks', PARTY_LABEL[open.partyType] ?? '—'],
                  ['Trucks claimed', open.trucksClaimed ?? 0],
                  ['Where they came from', leadSourceLabel(open.source)],
                  ['Notes', open.notes || '—'],
                ] as [string, ReactNode][])),
            [
              'Transporter',
              open.convertedVendorId ? (
                <Link key="v" href={`/vendors/${open.convertedVendorId}`}>
                  🚛 {open.convertedVendorName ?? open.convertedVendorCode ?? 'Open their file'}
                  {open.convertedVendorCode && open.convertedVendorName ? ` · ${open.convertedVendorCode}` : ''}
                </Link>
              ) : (
                <span key="v" className="muted">Not onboarded yet</span>
              ),
            ],
          ]}
          confirmLabel={can('vendor.edit') ? (linkTo ? 'Save and link' : 'Save changes') : 'Close'}
          confirmDisabled={can('vendor.edit') && !readyToSave}
          busy={saving}
          onConfirm={can('vendor.edit') ? saveEdit : () => setOpen(null)}
          onClose={() => setOpen(null)}
        >
          {can('vendor.edit') && (
            <>
              <LeadFields form={form} set={set} listId="cities-edit-lead" />
              {!open.convertedVendorId && (
                <Field
                  label="Already onboarded them as a transporter?"
                  hint="If they were added under Transporters without starting from this lead, pick their file here — the lead is then marked converted and linked to it."
                >
                  <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} disabled={!vendors}>
                    <option value="">{vendors ? 'No — not onboarded yet' : 'Loading transporters…'}</option>
                    {linkable.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.legalName} · {v.code} · {v.baseCity}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
        </Dialog>
      )}
    </ModuleGuard>
  );
}

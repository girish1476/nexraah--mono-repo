'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { listLeads, updateLead } from '../apis';
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

/** Leads — `/vendors/leads` (part 03 §3). The pipeline that feeds onboarding. */
export default function LeadsPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const columns: Column<Lead>[] = [
    { key: 'code', label: 'Lead', mono: true, render: (r) => r.code },
    {
      key: 'name',
      label: 'Name',
      render: (r) => (
        <div>
          <div>{r.name}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {r.city} · {r.partyType}
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', mono: true, render: (r) => r.phone },
    { key: 'trucks', label: 'Trucks claimed', align: 'right', render: (r) => r.trucksClaimed },
    { key: 'source', label: 'Source', render: (r) => <Tag tone="grey">{r.source}</Tag> },
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
      render: (r) =>
        r.stage === 'QUALIFIED' && can('vendor.edit') ? (
          <Link href="/vendors/new" className="btn btn-sm">
            Start onboarding
          </Link>
        ) : null,
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/leads"
        title="Leads"
        sub="New → Contacted → Documents requested → Qualified → Converted"
        module="vendors"
      />
      <Stack>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading leads" />}
        {rows && (
          <Panel pad={false}>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No leads in the pipeline." />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}

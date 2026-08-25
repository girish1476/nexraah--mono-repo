'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { inrCompact } from '@/lib/format';
import {
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
  Tone,
  useCan,
} from '@/lib/ui';
import { listVendors } from './apis';
import { PartyType, VendorListRow, VendorStatus } from './types';

const STATUS_TONE: Record<VendorStatus, Tone> = {
  DRAFT: 'grey',
  PENDING_VERIFICATION: 'flag',
  ACTIVE: 'mint',
  SUSPENDED: 'red',
  BLACKLISTED: 'red',
};

/**
 * The pill used to print the raw enum with its underscores swapped for
 * spaces — PENDING VERIFICATION, BLACKLISTED — which is a database value
 * shouting at somebody, not a status a person would say. These are the
 * sentences a transporter's file is actually in.
 */
const STATUS_LABEL: Record<VendorStatus, string> = {
  DRAFT: 'Being set up',
  PENDING_VERIFICATION: 'Papers being checked',
  ACTIVE: 'Cleared for loads',
  SUSPENDED: 'On hold',
  BLACKLISTED: 'Never use again',
};

const STATUS_EMOJI: Record<VendorStatus, string> = {
  DRAFT: '📝',
  PENDING_VERIFICATION: '🔍',
  ACTIVE: '✅',
  SUSPENDED: '⏸️',
  BLACKLISTED: '⛔',
};

/** An `OWNER` drives their own truck; a `VENDOR` books out other people's. */
const PARTY_LABEL: Record<PartyType, string> = {
  OWNER: 'Owns the truck',
  VENDOR: 'Books other trucks',
};

export default function VendorsPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<VendorListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | VendorStatus>('');

  const load = () => {
    setError(null);
    setRows(null);
    listVendors({ q: q || undefined, status: status || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };

  useEffect(load, [q, status]);

  const columns: Column<VendorListRow>[] = [
    /*
     * Nine columns did not fit a laptop, so the last one — the only one that
     * answers "can I actually give this transporter a load" — was scrolled
     * off the right edge where nobody would find it. Where they are based,
     * their code and their phone number are supporting detail nobody scans
     * independently, so they fold into the name; the same for the advance
     * policy under what we keep. Six columns, and the answer is on screen.
     */
    {
      key: 'code',
      label: 'Transporter',
      primary: true,
      render: (r) => r.legalName,
      sub: (r) => `${r.baseCity} · ${r.phone} · ${r.code}`,
    },
    {
      key: 'type',
      label: 'Kind of operator',
      render: (r) => (
        <Tag tone="grey" emoji={r.partyType === 'OWNER' ? '🚛' : '🏢'}>
          {PARTY_LABEL[r.partyType]}
        </Tag>
      ),
    },
    { key: 'fleet', label: 'Trucks owned', align: 'right', render: (r) => r.fleetCount },
    { key: 'trips', label: 'Loads carried', align: 'right', render: (r) => r.trips },
    {
      key: 'margin',
      label: 'What we keep',
      align: 'right',
      render: (r) => inrCompact(r.marginPaise),
      sub: (r) => `${r.advancePct}% paid up front`,
    },
    {
      key: 'status',
      // No `reason` here on purpose: a sentence of explanation per row makes
      // the last column wider than the screen. The pill says the state; the
      // transporter's own file says why.
      label: 'Can we give them loads?',
      render: (r) => (
        <Tag tone={STATUS_TONE[r.status]} emoji={STATUS_EMOJI[r.status]}>
          {STATUS_LABEL[r.status]}
        </Tag>
      ),
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors"
        title="Transporters"
        module="vendors"
        right={
          can('vendor.edit') && (
            <Link href="/vendors/new" className="btn">
              ➕ Add a transporter
            </Link>
          )
        }
      />
      <PageIntro
        what="Every transporter we work with — their fleet, how much we've moved with them, and whether their papers are in order."
        who="Operations onboards them; Compliance decides whether they pass."
      >
        A transporter cannot be given loads until Compliance has cleared their documents. That
        clearance is the gate the whole supply side hangs on.
      </PageIntro>

      <Stack>
        <Panel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px' }}>
              <Field label="Search">
                <input
                  placeholder="Transporter name or code"
                  defaultValue={q}
                  onBlur={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setQ((e.target as HTMLInputElement).value)}
                />
              </Field>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as VendorStatus | '')}>
                  <option value="">All</option>
                  {Object.keys(STATUS_TONE).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s as VendorStatus]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/vendors/leads" className="btn btn-secondary">
                🌱 New leads
              </Link>
              <Link href="/vendors/market-gap" className="btn btn-secondary">
                🗺️ Where we are short of trucks
              </Link>
              <Link href="/vendors/issues" className="btn btn-secondary">
                🛠️ Problems
              </Link>
            </div>
          </div>
        </Panel>

        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading transporters" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/vendors/${r.id}`)}
              empty="No transporter matches this search."
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}

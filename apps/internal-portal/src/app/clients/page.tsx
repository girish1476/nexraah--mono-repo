'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inrCompact } from '@/lib/format';
import {
  Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Tag,
  useCan,
  useLevel,
} from '@/lib/ui';
import { listClients } from './apis';
import { Client } from './types';

/**
 * Clients — `/clients`.
 *
 * Rate cards are read-only on this side: every lane price is what an RFQ award
 * wrote (BR-37). The intro says that in words a new joiner can act on; the
 * traceability lives here.
 */
export default function ClientsPage() {
  const router = useRouter();
  const level = useLevel('clients');
  // Module access is not the same as the permission. Compliance holds EDIT on
  // this module so it can work the onboarding queue, but not `client.manage` —
  // gating the button on the module showed it to them and 403'd on submit.
  const can = useCan();
  const [rows, setRows] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listClients().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<Client>[] = [
    {
      key: 'code',
      label: 'Client',
      render: (r) => (
        <div>
          <Link href={`/clients/${r.id}`} className="mono" style={{ fontSize: 12 }}>
            {r.code}
          </Link>
          <div>{r.name}</div>
        </div>
      ),
    },
    { key: 'city', label: 'Billing city', render: (r) => r.billingCity },
    {
      key: 'gstin',
      label: 'GSTIN (tax number)',
      mono: true,
      render: (r) => r.gstin ?? <span className="muted">Not on file</span>,
    },
    {
      key: 'engagement',
      label: 'How we price them',
      render: (r) =>
        r.engagement === 'CONTRACT' ? (
          <Tag
            tone="blue"
            reason={
              r.validTo
                ? `Agreed lane prices, valid to ${fmtDate(r.validTo)}`
                : 'Agreed lane prices under a signed agreement'
            }
          >
            Contract
          </Tag>
        ) : (
          <Tag tone="grey" reason="Priced load by load — no standing rate card">
            Spot
          </Tag>
        ),
    },
    {
      key: 'valid',
      label: 'Agreement valid to',
      render: (r) =>
        r.engagement === 'CONTRACT' ? (
          fmtDate(r.validTo)
        ) : (
          <span className="muted">No agreement — priced per load</span>
        ),
    },
    { key: 'credit', label: 'Payment terms', align: 'right', render: (r) => `${r.creditDays} days to pay` },
    {
      key: 'out',
      label: 'Unpaid with client',
      align: 'right',
      render: (r) => inrCompact(r.outstandingPaise),
    },
  ];

  return (
    <ModuleGuard module="clients">
      <PageHeader
        path="/clients"
        title="Clients"
        module="clients"
        right={
          can('client.manage') && (
            <Link href="/clients/new" className="btn">
              New client
            </Link>
          )
        }
      />
      <PageIntro
        what="Every company that ships with us — who to call, how long they get to pay, what they still owe, and the lane prices we agreed with them."
        who="Finance keeps this list. Everyone else can look, not change."
      >
        Open a client to see their rate card — the list of lanes (a from-city to to-city route) and the
        price agreed for each. Prices are set when we win a quote (RFQ), never typed in here.
      </PageIntro>
      {error && <ErrorState message={error} retry={load} />}
      {!rows && !error && <Loading what="Loading clients" />}
      {rows && (
        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/clients/${r.id}`)}
            empty={
              <EmptyState
                title="No clients on file yet"
                hint="A client is any company that books freight with us. Add the first one and it becomes selectable when an indent — a client's request for a truck — is raised, and when you invoice them."
                action={
                  can('client.manage') ? (
                    <Link href="/clients/new" className="btn">
                      New client
                    </Link>
                  ) : undefined
                }
              />
            }
          />
        </Panel>
      )}
    </ModuleGuard>
  );
}

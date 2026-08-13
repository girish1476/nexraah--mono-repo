'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { fmtDate, inr, inrCompact } from '@/lib/format';
import {
  Column,
  DataTable,
  ErrorState,
  FactList,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Split,
  Tag,
} from '@/lib/ui';
import { getClient, getRateCard } from '../apis';
import { Client, RateCardLane } from '../types';

/**
 * Client file — `/clients/[id]`.
 *
 * The rate card is read-only: it is the set of lanes won at RFQ, with rate,
 * validity, transit days and reporting rule per lane. It is never keyed here.
 */
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [lanes, setLanes] = useState<RateCardLane[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    Promise.all([getClient(id), getRateCard(id)])
      .then(([c, l]) => {
        setClient(c);
        setLanes(l);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!client) return <Loading what="Loading the client" />;

  const columns: Column<RateCardLane>[] = [
    { key: 'lane', label: 'Lane', render: (r) => `${r.origin} → ${r.destination}` },
    { key: 'truck', label: 'Truck type', render: (r) => r.truckType },
    { key: 'rate', label: 'Rate', align: 'right', render: (r) => inr(r.ratePaise) },
    { key: 'transit', label: 'Transit days', align: 'right', render: (r) => r.transitDays },
    { key: 'report', label: 'Reporting', render: (r) => r.reportingRule.replace(/_/g, ' ').toLowerCase() },
    { key: 'valid', label: 'Valid', render: (r) => `${fmtDate(r.validFrom)} – ${fmtDate(r.validTo)}` },
    { key: 'rfq', label: 'From RFQ lane', mono: true, render: (r) => r.rfqLaneId },
  ];

  return (
    <ModuleGuard module="clients">
      <PageHeader
        path={`/clients/${client.code}`}
        title={client.name}
        sub={`${client.code} · ${client.billingCity} · ${client.engagement.toLowerCase()}`}
        module="clients"
      />

      <Split
        aside={
          <Panel title="Client" pad={false}>
            <FactList
              facts={[
                ['Code', client.code],
                ['GSTIN', client.gstin ?? '—'],
                ['Contact', client.contact],
                ['Phone', client.phone],
                ['Email', client.email],
                ['Engagement', client.engagement],
                ['Agreement', client.agreementNo ?? '—'],
                ['Valid', client.validTo ? `${fmtDate(client.validFrom)} – ${fmtDate(client.validTo)}` : '—'],
                ['Credit', `${client.creditDays} days`],
                ['Service level', client.serviceLevel],
                ['Outstanding', inrCompact(client.outstandingPaise)],
              ]}
            />
          </Panel>
        }
      >
        <Panel
          title="Rate card"
          right={<Tag tone="grey">Read-only · from RFQ award</Tag>}
          pad={false}
        >
          {client.engagement === 'SPOT' ? (
            <div className="muted" style={{ padding: '22px 15px', fontSize: 13 }}>
              Rates are set per indent with the client’s written approval.
            </div>
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={lanes}
                rowKey={(r) => r.id}
                empty="No lanes priced yet. A contract with no rate card lanes is what the compliance desk warns about."
              />
              <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px' }}>
                Every line carries the RFQ lane it came from. A rate card line with no RFQ provenance cannot
                exist — the column is <code>NOT NULL</code> (BR-37).
              </div>
            </>
          )}
        </Panel>
      </Split>
    </ModuleGuard>
  );
}

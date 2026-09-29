'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime } from '@/lib/format';
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
} from '@/lib/ui';
import { getMyLoadingTrips, LoadingTripRow } from '../trips/apis';

/**
 * My loading trips — `/loading`. The loading supervisor's own screen: only the
 * trips assigned to them that are still waiting to leave. From each trip they
 * start and finish the loading and upload the loading slip, weighment slip,
 * e-way bill, client invoice and vehicle documents that the advance needs.
 */
export default function MyLoadingTripsPage() {
  const [rows, setRows] = useState<LoadingTripRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getMyLoadingTrips()
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading your trips" />;

  const columns: Column<LoadingTripRow>[] = [
    { key: 'trip', label: 'Trip', mono: true, primary: true, render: (r) => <Link href={`/trips/${r.id}`}>{r.code}</Link>, sub: (r) => r.lane },
    { key: 'vehicle', label: 'Vehicle', mono: true, render: (r) => r.vehicleNo || <span className="muted">Not allocated yet</span> },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    {
      key: 'state',
      label: 'Loading',
      render: (r) =>
        r.loadingCompletedAt ? (
          <Tag tone="mint">Completed {fmtDateTime(r.loadingCompletedAt)}</Tag>
        ) : r.loadingStartedAt ? (
          <Tag tone="flag">In progress since {fmtDateTime(r.loadingStartedAt)}</Tag>
        ) : (
          <Tag tone="grey">Not started</Tag>
        ),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Link href={`/trips/${r.id}`} className="btn btn-secondary btn-sm">
            Loading
          </Link>
          <Link href={`/trips/${r.id}/documents`} className="btn btn-sm">
            Upload documents
          </Link>
        </div>
      ),
    },
  ];

  return (
    <ModuleGuard module="loading">
      <PageHeader path="/loading" title="My loading trips" sub="Trips assigned to you that have not left yet" module="loading" />
      <PageIntro
        what="The trips you have been assigned to load. Open one to start and finish its loading, and to upload the loading slip, weighment slip, e-way bill, client invoice and vehicle documents. Compliance verifies them, and only then can the advance be paid."
        who="Each trip has one loading supervisor. You only see and act on your own trips."
      />
      <Panel pad={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="No trips assigned to you"
              hint="When Operations assigns you as the loading supervisor for a trip, it appears here."
            />
          }
        />
      </Panel>
    </ModuleGuard>
  );
}

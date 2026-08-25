'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { inr } from '@/lib/format';
import {
  Column,
  DataTable,
  EmptyState,
  ErrorState,
  Glyph,
  Journey,
  JourneyMini,
  Loading,
  ModuleGuard,
  NextAction,
  PageHeader,
  PageIntro,
  Panel,
  StageTabs,
  Stack,
  Toolbar,
  useCan,
} from '@/lib/ui';
import { listOrders, orderCounts } from './apis';
import {
  ORDER_NEXT_ACTION,
  ORDER_PHASE_EMOJI,
  ORDER_PHASE_LABEL,
  ORDER_PHASE_SEQUENCE,
  ORDER_STATUS_TONE,
  OrderCounts,
  OrderListRow,
  OrderPhase,
  phaseFor,
} from './types';

/**
 * `/orders` — every shipment's lifecycle in one list.
 *
 * Built around one question rather than one entity: *what needs me, and what
 * do I do about it?* So the phase tabs lead, the row's dominant line is the
 * client and lane rather than the order code, the next action and its owner
 * sit second, and how far along it is renders as progress instead of a noun.
 * Nothing here mutates anything — every action opens the indent, trip, POD or
 * invoice that owns it.
 */
export default function OrdersPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<OrderListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<OrderPhase | 'ALL'>('NEEDS_YOU');
  const [q, setQ] = useState('');
  // What the server says exists, so the screen can admit when it is showing
  // a page rather than everything.
  const [total, setTotal] = useState(0);
  // Counts come from the server, not from the loaded page. Deriving them from
  // `rows` looked fine while the list was unpaged and every order was in
  // memory; the moment it pages, a tab would report how many of *this page*
  // are in that phase and read as a total. A tab that quietly undercounts is
  // worse than no tab.
  const [statusCounts, setStatusCounts] = useState<OrderCounts>({});

  const load = () => {
    setError(null);
    listOrders({ limit: 200 })
      .then((page) => {
        setRows(page.rows);
        setTotal(page.total);
      })
      .catch((e) => setError(errorMessage(e)));
    orderCounts()
      .then(setStatusCounts)
      // A failed count must not blank the list — the tabs fall back to zero
      // and the rows still render.
      .catch(() => setStatusCounts({}));
  };
  useEffect(load, []);

  // Ten server-side status counts folded into the five phases the tabs show.
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const [status, n] of Object.entries(statusCounts)) {
      const phaseKey = phaseFor(status as OrderListRow['status']);
      acc[phaseKey] = (acc[phaseKey] ?? 0) + (n ?? 0);
    }
    return acc;
  }, [statusCounts]);

  const countedTotal = useMemo(
    () => Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0),
    [statusCounts],
  );

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => phase === 'ALL' || phaseFor(r.status) === phase)
      .filter(
        (r) =>
          !term ||
          r.clientName.toLowerCase().includes(term) ||
          r.lane.toLowerCase().includes(term) ||
          r.orderNo.toLowerCase().includes(term) ||
          r.indentCode.toLowerCase().includes(term) ||
          (r.tripCode ?? '').toLowerCase().includes(term),
      );
  }, [rows, phase, q]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading orders" />;

  const columns: Column<OrderListRow>[] = [
    {
      key: 'order',
      label: 'Order',
      primary: true,
      render: (r) => r.clientName,
      sub: (r) => `${r.lane} · ${r.orderNo} · ${r.indentCode}`,
    },
    {
      key: 'next',
      label: 'Next action',
      render: (r) => {
        const next = ORDER_NEXT_ACTION[r.status];
        return (
          <NextAction
            action={next.action}
            owner={next.owner || undefined}
            tone={ORDER_STATUS_TONE[r.status]}
          />
        );
      },
    },
    { key: 'value', label: 'Value', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'stage',
      label: 'How far along',
      render: (r) =>
        r.status === 'FAILED' ? (
          <JourneyMini step={1} tone="red" label="No vehicle found" />
        ) : (
          <JourneyMini step={r.stepNo} tone={ORDER_STATUS_TONE[r.status]} />
        ),
    },
  ];

  const tabs = [
    ...ORDER_PHASE_SEQUENCE.map((p) => ({
      key: p,
      label: `${ORDER_PHASE_EMOJI[p]} ${ORDER_PHASE_LABEL[p]}`,
      count: counts[p] ?? 0,
      tone: p === 'NEEDS_YOU' ? ('flag' as const) : undefined,
    })),
    { key: 'ALL', label: '📦 All', count: countedTotal || rows.length },
  ];

  return (
    <ModuleGuard module="orders">
      <PageHeader
        title="All shipments"
        sub="Every load we are moving, and how far along it is"
        module="orders"
        right={
          can('indent.create') && (
            <Link href="/indents/new" className="btn">
              📝 New load request
            </Link>
          )
        }
      />
      <PageIntro
        what="One row per load, from the moment a client asks us to move it to the moment the transporter is paid in full."
        who="Anyone can look here. To change something, open the load request, the trip or the bill it links to."
      />

      {/* The legend, and the page's own explanation of what a shipment goes
          through. Ten emoji are self-explanatory only once — this is where
          somebody learns them, so the little rail in every row below stops
          needing a translation. */}
      <details className="journey-legend">
        <summary>
          <Glyph size={17}>🚚</Glyph>
          What every load goes through — the ten steps
        </summary>
        <div style={{ paddingTop: 14 }}>
          <Journey step={0} />
          <div className="hint" style={{ marginTop: 4 }}>
            The row of dots in the list below is these ten steps. Filled dots are done, and the
            emoji beside them names where the load is sitting right now.
          </div>
        </div>
      </details>

      <Stack gap={0}>
        <StageTabs tabs={tabs} value={phase} onChange={(k) => setPhase(k as OrderPhase | 'ALL')} />

        <Toolbar
          search={
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Client, lane, order or trip number…"
              aria-label="Search orders"
            />
          }
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/orders/${r.id}`)}
            empty={
              q.trim() ? (
                <EmptyState
                  title="Nothing matches that search"
                  hint="Try a client name, a city on the lane, or an order or trip number."
                />
              ) : phase === 'NEEDS_YOU' ? (
                <EmptyState
                  title="Nothing is waiting on you"
                  hint="Orders appear here when someone has to act — a placement that failed, advance documents to verify, or proof of delivery to check. Everything else is moving on its own."
                />
              ) : (
                <EmptyState
                  title={`No orders in ${ORDER_PHASE_LABEL[phase as OrderPhase] ?? 'this phase'}`}
                  hint="An order appears the moment an indent is raised, then tracks itself through placement, the trip, delivery and payment."
                  action={
                    can('indent.create') ? (
                      <Link href="/indents/new" className="btn">
                        Raise an indent
                      </Link>
                    ) : undefined
                  }
                />
              )
            }
          />
        </Panel>

        {/*
          Say so when the screen is showing a page rather than everything.

          The list is capped at 200 server-side. Silently rendering the first
          page as though it were the whole list is the failure the old unpaged
          version could not have — it fetched every row — so the honest thing
          is to admit the cap rather than inherit its confidence.
        */}
        {total > rows.length && (
          <div className="hint" style={{ marginTop: 12 }}>
            Showing the {rows.length} most recent of {total} orders. Narrow it with a search or a
            phase above.
          </div>
        )}
      </Stack>
    </ModuleGuard>
  );
}

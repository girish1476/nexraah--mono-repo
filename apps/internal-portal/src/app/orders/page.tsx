'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { inr } from '@/lib/format';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { emptyFilters, FilterBar, FilterField, FilterValues, activeFilterCount } from '@/lib/list-filters';
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
  Tag,
  useCan,
} from '@/lib/ui';
import { listAllOrders, listOrders, OrderSearchParams, orderCounts } from './apis';
import {
  ORDER_NEXT_ACTION,
  ORDER_PHASE_EMOJI,
  ORDER_PHASE_LABEL,
  ORDER_PHASE_SEQUENCE,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_SEQUENCE,
  ORDER_STATUS_TONE,
  OrderCounts,
  OrderListRow,
  OrderPhase,
  OrderStatus,
  phaseFor,
} from './types';

const PAGE_SIZE = 200;

/** Every status, in the order a load meets them, with the two that are not steps last. */
const ALL_STATUSES: OrderStatus[] = [...ORDER_STATUS_SEQUENCE, 'FAILED', 'POD_FORFEITED', 'CANCELLED'];

/**
 * The search boxes above the list. The wording follows the owner's note for
 * the "All Orders page"; each maps to one field the server searches.
 */
const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'Client, city, load request…' },
  {
    kind: 'select',
    key: 'stage',
    label: 'Order stage',
    allLabel: 'Any stage',
    options: ALL_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] })),
  },
  { kind: 'text', key: 'vendor', label: 'Name of the vendor', placeholder: 'Transporter name' },
  { kind: 'text', key: 'clientName', label: 'Client details', placeholder: 'Name, GST number, contact…' },
  { kind: 'text', key: 'from', label: 'From location', placeholder: 'Pick-up city' },
  { kind: 'text', key: 'to', label: 'To location', placeholder: 'Delivery city' },
  { kind: 'text', key: 'truck', label: 'Truck number', placeholder: 'e.g. MH12AB1234' },
  { kind: 'text', key: 'ref', label: 'Indent ID / Trip ID', placeholder: 'Indent, trip or LR number' },
  { kind: 'text', key: 'branchName', label: 'Branch name', placeholder: 'Branch name' },
];

/** The steps that belong to one tab, so a tab is a server-side filter and not a view of one page. */
function statusesIn(phase: OrderPhase | 'ALL'): string | undefined {
  if (phase === 'ALL') return undefined;
  return ALL_STATUSES.filter((s) => phaseFor(s) === phase).join(',');
}

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
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));
  // What the server says matches, so the screen can admit when it is showing
  // a page rather than everything.
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Counts come from the server, not from the loaded page. Deriving them from
  // `rows` looked fine while the list was unpaged and every order was in
  // memory; the moment it pages, a tab would report how many of *this page*
  // are in that phase and read as a total. A tab that quietly undercounts is
  // worse than no tab.
  const [statusCounts, setStatusCounts] = useState<OrderCounts>({});

  // The search the server is asked, without the step: the tabs and the stage
  // box both decide that, and the counts deliberately ignore it.
  const searchParams = useMemo<OrderSearchParams>(
    () => ({
      q: filters.q,
      clientName: filters.clientName,
      vendor: filters.vendor,
      from: filters.from,
      to: filters.to,
      truck: filters.truck,
      ref: filters.ref,
      branchName: filters.branchName,
    }),
    [filters],
  );
  // Picking one stage wins over the tab; otherwise the tab's steps apply.
  const status = filters.stage || statusesIn(phase);

  // Only the newest request may write to the screen — typing quickly fires
  // several, and a slow early one landing last would show stale rows.
  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++latest.current;
    setError(null);
    setLoading(true);
    listOrders({ ...searchParams, status, limit: PAGE_SIZE })
      .then((page) => {
        if (mine !== latest.current) return;
        setRows(page.rows);
        setTotal(page.total);
      })
      .catch((e) => mine === latest.current && setError(errorMessage(e)))
      .finally(() => mine === latest.current && setLoading(false));
  }, [searchParams, status]);
  useEffect(load, [load]);

  useEffect(() => {
    let current = true;
    orderCounts(searchParams)
      .then((c) => current && setStatusCounts(c))
      // A failed count must not blank the list — the tabs fall back to zero
      // and the rows still render.
      .catch(() => current && setStatusCounts({}));
    return () => {
      current = false;
    };
  }, [searchParams]);

  const showMore = () => {
    if (!rows) return;
    const mine = ++latest.current;
    setLoading(true);
    listOrders({ ...searchParams, status, limit: PAGE_SIZE, offset: rows.length })
      .then((page) => {
        if (mine !== latest.current) return;
        setRows((prev) => [...(prev ?? []), ...page.rows]);
        setTotal(page.total);
      })
      .catch((e) => mine === latest.current && setError(errorMessage(e)))
      .finally(() => mine === latest.current && setLoading(false));
  };

  const changeFilters = (next: FilterValues) => {
    setExportNote(null);
    // Choosing a stage moves the tab to the phase it belongs to, so the tab
    // strip never claims one thing while the list shows another.
    if (next.stage && next.stage !== filters.stage) {
      const owner = phaseFor(next.stage as OrderStatus);
      if (phase !== 'ALL' && phase !== owner) setPhase(owner);
    }
    setFilters(next);
  };
  const changeTab = (key: string) => {
    setExportNote(null);
    setPhase(key as OrderPhase | 'ALL');
    // A stage that is not in the tab just chosen would empty the list; drop it.
    if (filters.stage && key !== 'ALL' && phaseFor(filters.stage as OrderStatus) !== key) {
      setFilters({ ...filters, stage: '' });
    }
  };

  const exportRows = async () => {
    const { rows: everything, total: all, truncated } = await listAllOrders({ ...searchParams, status });
    downloadCsv(
      `orders-${todayStamp()}.csv`,
      [
        'Client', 'From', 'To', 'Load request', 'Trip', 'Transporter', 'Truck number', 'Branch',
        'Stage', 'Next action', 'Pick-up date', 'Value (INR)', 'Invoice',
      ],
      everything.map((r) => [
        r.clientName, r.fromCity, r.toCity, r.indentCode, r.tripCode, r.vendorName, r.vehicleNo, r.branchName,
        ORDER_STATUS_LABEL[r.status], ORDER_NEXT_ACTION[r.status].action, r.pickupDate?.slice(0, 10),
        r.sellRatePaise / 100, r.invoiceCode,
      ]),
    );
    setExportNote(
      truncated
        ? `Exported the first ${everything.length.toLocaleString('en-IN')} of ${all.toLocaleString('en-IN')} orders — narrow the search to get the rest.`
        : `Exported ${everything.length.toLocaleString('en-IN')} order${everything.length === 1 ? '' : 's'}.`,
    );
  };

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

  // A failure before anything has loaded takes the page; after that it only
  // takes the table, so the filter boxes keep what somebody typed into them.
  if (error && !rows) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading orders" />;

  const columns: Column<OrderListRow>[] = [
    {
      key: 'order',
      label: 'Client details',
      primary: true,
      render: (r) => r.clientName,
      sub: (r) => r.lane,
    },
    {
      key: 'transporter',
      label: 'Name of the vendor',
      render: (r) => r.vendorName ?? <span className="muted">Not booked yet</span>,
    },
    // Each thing the owner listed for this page is a column of its own: where it
    // loads, where it goes, which truck, and which branch owns it.
    { key: 'from', label: 'From location', render: (r) => r.fromCity },
    { key: 'to', label: 'To location', render: (r) => r.toCity },
    {
      key: 'truck',
      label: 'Truck number',
      mono: true,
      render: (r) => r.vehicleNo ?? <span className="muted">—</span>,
    },
    { key: 'branch', label: 'Branch name', render: (r) => r.branchName },
    // Indent ID, trip ID and status as their own columns — a dispatcher scans
    // by number, not just by client name. There is no separate order id.
    { key: 'indentId', label: 'Indent ID', mono: true, render: (r) => r.indentCode },
    { key: 'tripId', label: 'Trip ID', mono: true, render: (r) => r.tripCode ?? <span className="muted">—</span> },
    {
      key: 'status',
      label: 'Order stage',
      render: (r) => <Tag tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Tag>,
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
    { key: 'ALL', label: '📦 All shipments', count: countedTotal },
  ];

  return (
    <ModuleGuard module="orders">
      <PageHeader
        title="All orders"
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
        <StageTabs tabs={tabs} value={phase} onChange={changeTab} />

        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={changeFilters}
          onExport={exportRows}
          resultNote={
            exportNote ??
            (loading
              ? 'Updating…'
              : `${total.toLocaleString('en-IN')} order${total === 1 ? '' : 's'} found`)
          }
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/orders/${r.id}`)}
            empty={
              activeFilterCount(filters) > 0 ? (
                phase !== 'ALL' && countedTotal > 0 ? (
                  // The tab is a filter too. Say where the matches are rather
                  // than showing a blank that reads as "no such order".
                  <EmptyState
                    title="Nothing in this tab matches"
                    hint={`${countedTotal.toLocaleString('en-IN')} other order${countedTotal === 1 ? ' matches' : 's match'} this search under a different tab.`}
                    action={
                      <button type="button" className="btn" onClick={() => changeTab('ALL')}>
                        Search all shipments
                      </button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="Nothing matches these filters"
                    hint="Loosen one of the boxes above, or use Clear to start again."
                  />
                )
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
          <div className="hint" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>
              Showing the {rows.length} most recent of {total.toLocaleString('en-IN')} orders.
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={showMore} disabled={loading}>
              Show the next {Math.min(PAGE_SIZE, total - rows.length)}
            </button>
          </div>
        )}
        {error && rows && <ErrorState message={error} retry={load} />}
      </Stack>
    </ModuleGuard>
  );
}

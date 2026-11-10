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
  JourneyMini,
  Loading,
  ModuleGuard,
  NextAction,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useCan,
} from '@/lib/ui';
import { listAllOrders, listOrders, OrderSearchParams, orderCounts } from './apis';
import {
  ORDER_NEXT_ACTION,
  ORDER_PHASE_EMOJI,
  ORDER_PHASE_LABEL,
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

/** The quick views under the search (owner's request, 10 Nov 2026), and the steps each one lists. */
type View = 'ALL' | Extract<OrderPhase, 'PLACING' | 'MOVING' | 'DELIVERED'>;
const VIEWS: View[] = ['ALL', 'PLACING', 'MOVING', 'DELIVERED'];
const statusesIn = (view: View) =>
  view === 'ALL' ? undefined : ALL_STATUSES.filter((s) => phaseFor(s) === view).join(',');

/**
 * `/orders` — every shipment's lifecycle in one list.
 *
 * The search boxes lead and every order is listed under them, newest first —
 * no phase tabs, intro or legend (owner's request, 10 Nov 2026): the Order
 * stage box narrows to one step. The row's dominant line is the client and
 * lane, the next action and its owner sit beside the stage, and how far along
 * it is renders as progress. Nothing here mutates anything — every action
 * opens the indent, trip, POD or invoice that owns it.
 */
export default function OrdersPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<OrderListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));
  // What the server says matches, so the screen can admit when it is showing
  // a page rather than everything.
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [view, setView] = useState<View>('ALL');
  // Per step, for the counts on the quick views — what the search found, whatever the view.
  const [counts, setCounts] = useState<OrderCounts>({});

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
      // One stage picked in the box wins; otherwise the view's steps.
      status: filters.stage || statusesIn(view),
    }),
    [filters, view],
  );

  useEffect(() => {
    let current = true;
    orderCounts(searchParams)
      .then((c) => current && setCounts(c))
      // A failed count must not blank the list — the views just show no number.
      .catch(() => current && setCounts({}));
    return () => {
      current = false;
    };
    // The counts ignore the view and the stage, so only the search boxes refetch them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.clientName, filters.vendor, filters.from, filters.to, filters.truck, filters.ref, filters.branchName]);

  const countOf = (v: View) =>
    Object.entries(counts).reduce((a, [s, n]) => a + (v === 'ALL' || phaseFor(s as OrderStatus) === v ? (n ?? 0) : 0), 0);

  // Only the newest request may write to the screen — typing quickly fires
  // several, and a slow early one landing last would show stale rows.
  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++latest.current;
    setError(null);
    setLoading(true);
    listOrders({ ...searchParams, limit: PAGE_SIZE })
      .then((page) => {
        if (mine !== latest.current) return;
        setRows(page.rows);
        setTotal(page.total);
      })
      .catch((e) => mine === latest.current && setError(errorMessage(e)))
      .finally(() => mine === latest.current && setLoading(false));
  }, [searchParams]);
  useEffect(load, [load]);

  const showMore = () => {
    if (!rows) return;
    const mine = ++latest.current;
    setLoading(true);
    listOrders({ ...searchParams, limit: PAGE_SIZE, offset: rows.length })
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
    // Picking one stage is narrower than any view; the views go back to all.
    if (next.stage && next.stage !== filters.stage) setView('ALL');
    setFilters(next);
  };
  const changeView = (next: View) => {
    setExportNote(null);
    setView(next);
    if (filters.stage) setFilters({ ...filters, stage: '' });
  };

  const exportRows = async () => {
    const { rows: everything, total: all, truncated } = await listAllOrders(searchParams);
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
      <Stack gap={0}>
        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={changeFilters}
          onExport={exportRows}
          resultNote={
            exportNote ??
            (loading ? 'Updating…' : `${total.toLocaleString('en-IN')} order${total === 1 ? '' : 's'} found`)
          }
        />

        {/* Quick views under the search, each with how many the search found there. */}
        <nav aria-label="Quick views" data-testid="order-quick-views" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={view === v && !filters.stage ? 'btn btn-sm' : 'btn btn-secondary btn-sm'}
              aria-pressed={view === v && !filters.stage}
              onClick={() => changeView(v)}
            >
              {v === 'ALL' ? '📦 All orders' : `${ORDER_PHASE_EMOJI[v]} ${ORDER_PHASE_LABEL[v]}`} · {countOf(v).toLocaleString('en-IN')}
            </button>
          ))}
          {can('indent.view') && (
            <Link href="/indents" className="btn btn-secondary btn-sm">
              📝 Indents
            </Link>
          )}
        </nav>

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/orders/${r.id}`)}
            empty={
              activeFilterCount(filters) > 0 ? (
                <EmptyState title="Nothing matches these filters" hint="Loosen one of the boxes above, or use Clear to start again." />
              ) : view !== 'ALL' ? (
                <EmptyState
                  title={`Nothing in ${ORDER_PHASE_LABEL[view]} right now`}
                  hint="Every load is in another step."
                  action={
                    <button type="button" className="btn" onClick={() => changeView('ALL')}>
                      Show all orders
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="No orders yet"
                  hint="An order appears the moment a load request is raised, then tracks itself through placement, the trip, delivery and payment."
                  action={
                    can('indent.create') ? (
                      <Link href="/indents/new" className="btn">
                        Raise a load request
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

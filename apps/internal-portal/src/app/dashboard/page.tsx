'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listApprovals } from '@/app/admin/approvals/apis';
import { ApprovalRow } from '@/app/admin/approvals/types';
import { getDeskTargets } from '@/app/admin/targets/apis';
import { DeskTargets, TARGET_EMOJI, TARGET_LABEL } from '@/app/admin/targets/types';
import { AllowedEmail, listAllowedEmails } from '@/app/admin/users/apis';
import { getHome } from '@/app/home/apis';
import { HomeResponse } from '@/app/home/types';
import { getReceivables } from '@/app/invoices/apis';
import { AgeingBucket, ReceivablesResponse } from '@/app/invoices/types';
import { listAllOrders } from '@/app/orders/apis';
import { ORDER_STATUS_LABEL, OrderListRow, OrderStatus } from '@/app/orders/types';
import { listTickets } from '@/app/tickets/apis';
import { TicketQueue } from '@/app/tickets/types';
import { listVendors } from '@/app/vendors/apis';
import { VendorListRow, VendorStatus } from '@/app/vendors/types';
import { BarRow, ChartCard, ChartEmpty, ColumnPoint, Columns, HBars, Meter, StatTile } from '@/components/charts';
import { inrCompact, pct } from '@/lib/format';
import { LiveStamp, useLiveRefresh } from '@/lib/live';
import { ROLES, RoleCode } from '@/lib/permissions';
import { Loading, ModuleGuard, PageHeader } from '@/lib/ui';

/** The order's steps in the order a load passes through them, then the three ways one ends badly. */
const PIPELINE: OrderStatus[] = [
  'INDENT_CREATED',
  'TRIP_GENERATED',
  'LR_ISSUED',
  'ADVANCE_DOCS_UPLOADED',
  'ADVANCE_PAID',
  'TRACKING',
  'UNLOADED',
  'POD_UPLOADED',
  'POD_VERIFIED',
  'BALANCE_RELEASED',
];
const EXCEPTIONS: OrderStatus[] = ['FAILED', 'CANCELLED', 'POD_FORFEITED'];

const BUCKETS: [AgeingBucket, string][] = [
  ['CURRENT', 'Not yet due'],
  ['D0_30', 'Overdue up to 30 days'],
  ['D31_60', 'Overdue 31 to 60 days'],
  ['D61_90', 'Overdue 61 to 90 days'],
  ['D90_PLUS', 'Overdue more than 90 days'],
];

const VENDOR_STATUS: [VendorStatus, string][] = [
  ['ACTIVE', 'Active'],
  ['PENDING_VERIFICATION', 'Waiting for Compliance'],
  ['DRAFT', 'Draft — not submitted'],
  ['SUSPENDED', 'On hold'],
  ['BLACKLISTED', 'Blacklisted'],
];

const APPROVAL_LABEL: Record<string, string> = {
  ABOVE_BAND_PRICE: 'Above-band award',
  ADVANCE_OVERRIDE: 'Advance override',
  ADVANCE_POLICY_CHANGE: 'Advance policy change',
  PENALTY_WAIVER: 'POD penalty waiver',
  DOC_OVERRIDE: 'Document override',
  BRANCH_OVERRIDE: 'Branch override',
  RATE_REVISION: 'Change to an agreed client rate',
  LANE_BAND_CHANGE: 'Change to a lane’s bid limits',
  RATE_CARD_LANE: 'New agreed client rate',
};

const count = (n: number) => n.toLocaleString('en-IN');
const money = (paise: number) => inrCompact(paise);

interface Everything {
  home: HomeResponse | null;
  orders: OrderListRow[] | null;
  receivables: ReceivablesResponse | null;
  vendors: VendorListRow[] | null;
  people: AllowedEmail[] | null;
  tickets: TicketQueue | null;
  approvals: ApprovalRow[] | null;
  targets: DeskTargets | null;
}

/** Every figure comes from a screen that already exists; one of them failing must not blank the rest. */
async function loadEverything(): Promise<Everything> {
  const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [home, orders, receivables, vendors, people, tickets, approvals, targets] = await Promise.all([
    safe(getHome()),
    safe(listAllOrders({}).then((r) => r.rows)),
    safe(getReceivables()),
    safe(listVendors()),
    safe(listAllowedEmails()),
    safe(listTickets()),
    safe(listApprovals({ status: 'PENDING' })),
    safe(getDeskTargets()),
  ]);
  return { home, orders, receivables, vendors, people, tickets, approvals, targets };
}

/** The last thirty days, oldest first, as `YYYY-MM-DD`. */
function lastThirtyDays(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const tally = <T extends string>(values: T[]): Map<T, number> => {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return map;
};

/**
 * Administrator's dashboard — `/dashboard`.
 *
 * The whole console on one screen, in charts: how many loads are at each step,
 * what was booked day by day, what each branch and client is worth, what is
 * owed and for how long, the proofs of delivery, the transporters, the people
 * who can sign in, and what is waiting on somebody.
 *
 * It adds no figures of its own. Each chart is drawn from the same request the
 * screen behind it makes, and links to that screen, so a number here can
 * always be opened and checked.
 */
export default function AdminDashboardPage() {
  const [data, setData] = useState<Everything | null>(null);
  useEffect(() => {
    void loadEverything().then(setData);
  }, []);
  const updatedAt = useLiveRefresh(() => loadEverything().then(setData), 60_000);

  if (!data) {
    return (
      <ModuleGuard module="admin">
        <Loading what="Gathering the figures" />
      </ModuleGuard>
    );
  }

  const { home, orders, receivables, vendors, people, tickets, approvals, targets } = data;

  // ---- orders ---------------------------------------------------------------
  const byStatus = tally((orders ?? []).map((o) => o.status));
  const stageRows: BarRow[] = [
    ...PIPELINE.map((s) => ({ label: ORDER_STATUS_LABEL[s], value: byStatus.get(s) ?? 0 })),
    ...EXCEPTIONS.filter((s) => byStatus.get(s)).map((s) => ({
      label: ORDER_STATUS_LABEL[s],
      value: byStatus.get(s) ?? 0,
      flag: 'needs a look',
    })),
  ];
  const open = (orders ?? []).filter((o) => o.status !== 'BALANCE_RELEASED' && !EXCEPTIONS.includes(o.status)).length;

  const days = lastThirtyDays();
  const byDay = tally((orders ?? []).map((o) => String(o.pickupDate ?? '').slice(0, 10)));
  const dayPoints: ColumnPoint[] = days.map((d) => ({ label: dayLabel(d), name: dayLabel(d), value: byDay.get(d) ?? 0 }));

  const byBranch = tally((orders ?? []).map((o) => o.branchName || 'No branch'));
  const branchLoadRows: BarRow[] = [...byBranch.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  // ---- money ----------------------------------------------------------------
  const branchMoneyRows: BarRow[] = (home?.branches ?? []).map((b) => ({
    label: b.branchName,
    value: b.revenuePaise,
    second: b.costPaise,
  }));
  const clientRows: BarRow[] = (home?.topClients ?? []).map((c) => ({ label: c.clientName, value: c.revenuePaise }));
  const bucketRows: BarRow[] = BUCKETS.map(([bucket, label]) => ({
    label,
    value: receivables?.buckets.find((b) => b.bucket === bucket)?.amountPaise ?? 0,
    flag: bucket === 'D90_PLUS' && receivables?.buckets.find((b) => b.bucket === bucket)?.amountPaise ? 'chase' : undefined,
  }));
  const standingRows: BarRow[] = home
    ? [
        { label: 'Owed to us by clients', value: home.standing.receivablesPaise },
        { label: 'Final payments still to release', value: home.standing.balancePendingPaise },
        { label: 'Advance out on running trips', value: home.standing.advanceOutstandingPaise },
      ]
    : [];

  // ---- supply and people ----------------------------------------------------
  const byVendor = tally((vendors ?? []).map((v) => v.status));
  const vendorRows: BarRow[] = VENDOR_STATUS.map(([status, label]) => ({
    label,
    value: byVendor.get(status) ?? 0,
    flag: status === 'PENDING_VERIFICATION' && byVendor.get(status) ? 'waiting' : undefined,
  })).filter((r) => r.value > 0 || r.label === 'Active');
  const activePeople = (people ?? []).filter((p) => p.status !== 'DISABLED');
  const byRole = tally(activePeople.map((p) => String(p.role)));
  const roleRows: BarRow[] = [...byRole.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, value]) => ({ label: ROLES[role as RoleCode]?.label ?? role, value }));

  // ---- waiting on somebody --------------------------------------------------
  const byKind = tally((approvals ?? []).map((a) => String(a.kind)));
  const approvalRows: BarRow[] = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, value]) => ({ label: APPROVAL_LABEL[kind] ?? kind, value }));

  const marginShare = home && home.month.revenuePaise > 0 ? (home.month.marginPaise / home.month.revenuePaise) * 100 : null;
  const formatTarget = (unit: 'COUNT' | 'PAISE') => (unit === 'COUNT' ? count : money);

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/dashboard"
        title="Dashboard"
        sub="The whole console in charts. Every chart is drawn from the screen behind it — open that screen to see the records."
        module="admin"
        right={<LiveStamp at={updatedAt} />}
      />

      {/* ---- the headline numbers ---- */}
      <div className="viz-tiles">
        <StatTile emoji="🚚" label="Loads in progress" value={orders ? count(open) : '—'} note={orders ? `${count(orders.length)} loads in all` : 'Orders could not be read'} />
        <StatTile emoji="🧾" label="Billed this month" value={home ? money(home.month.revenuePaise) : '—'} note={home ? `${count(home.month.trips)} delivered trips` : undefined} />
        <StatTile emoji="📈" label="Margin this month" value={home ? money(home.month.marginPaise) : '—'} note={marginShare !== null ? `${pct(marginShare)} of what was billed` : undefined} />
        <StatTile emoji="⏱️" label="Delivered on time" value={home ? pct(home.month.onTimePct) : '—'} note="of this month’s delivered trips" />
        <StatTile emoji="📥" label="Owed to us" value={home ? money(home.standing.receivablesPaise) : '—'} note={home ? `${count(home.standing.unbilledTrips)} delivered trips not billed yet` : undefined} tone={home && home.standing.unbilledTrips > 0 ? 'warn' : undefined} />
        <StatTile emoji="✋" label="Approvals waiting" value={approvals ? count(approvals.length) : '—'} note="across every desk" tone={approvals && approvals.length > 0 ? 'warn' : undefined} />
        <StatTile emoji="🎫" label="Open tickets" value={tickets ? count(tickets.summary.open + tickets.summary.inProgress) : '—'} note={tickets && tickets.summary.blocking > 0 ? `${count(tickets.summary.blocking)} blocking somebody` : 'none blocking'} tone={tickets && tickets.summary.blocking > 0 ? 'bad' : undefined} />
        <StatTile emoji="👥" label="People who can sign in" value={people ? count(activePeople.length) : '—'} note={people ? `${count(people.length - activePeople.length)} switched off` : undefined} />
      </div>

      <div className="viz-grid">
        {/* ---- orders ---- */}
        <ChartCard title="Loads at each step" note="Every load, by the step it has reached" wide>
          {orders ? <HBars rows={stageRows} format={count} empty="No loads have been raised yet." /> : <ChartEmpty>Orders could not be read.</ChartEmpty>}
          <CardLink href="/orders">Open Orders</CardLink>
        </ChartCard>

        <ChartCard title="Loads by pickup day" note="Last 30 days" wide>
          {orders ? <Columns points={dayPoints} format={count} unit="Loads" empty="No loads were picked up in the last 30 days." /> : <ChartEmpty>Orders could not be read.</ChartEmpty>}
        </ChartCard>

        <ChartCard title="Loads by branch" note="Every load, by the branch that runs it">
          {orders ? <HBars rows={branchLoadRows} format={count} /> : <ChartEmpty>Orders could not be read.</ChartEmpty>}
        </ChartCard>

        <ChartCard
          title="Billed and cost by branch"
          note="This month’s delivered trips"
          legend={[
            { label: 'Billed to clients', series: 1 },
            { label: 'Paid to transporters', series: 2 },
          ]}
        >
          {home ? <HBars rows={branchMoneyRows} format={money} empty="No trips were delivered this month." /> : <ChartEmpty>The month’s figures could not be read.</ChartEmpty>}
          <CardLink href="/pnl">Open Profit and loss</CardLink>
        </ChartCard>

        {/* ---- money ---- */}
        <ChartCard title="Biggest clients" note="By what was billed this month">
          {home ? <HBars rows={clientRows} format={money} empty="Nothing was billed this month." /> : <ChartEmpty>The month’s figures could not be read.</ChartEmpty>}
          <CardLink href="/clients">Open Clients</CardLink>
        </ChartCard>

        <ChartCard title="What clients owe, by age" note="Unpaid invoices today">
          {receivables ? <HBars rows={bucketRows} format={money} empty="No invoice is unpaid." /> : <ChartEmpty>Receivables could not be read.</ChartEmpty>}
          <CardLink href="/receivables">Open Receivables</CardLink>
        </ChartCard>

        <ChartCard title="Where the money stands" note="As of now">
          {home ? <HBars rows={standingRows} format={money} empty="Nothing is outstanding." /> : <ChartEmpty>The figures could not be read.</ChartEmpty>}
          <CardLink href="/payments/balance">Open Payments</CardLink>
        </ChartCard>

        <ChartCard title="Proof of delivery" note="This month’s delivered trips">
          {home ? (
            <>
              <Meter emoji="📸" label="Proofs collected" value={home.pod.collected} of={home.pod.delivered} format={count} />
              <HBars
                rows={[
                  { label: 'Collected in time', value: home.pod.withinTat },
                  { label: 'Past the time allowed', value: home.pod.breached, flag: home.pod.breached ? 'late' : undefined },
                  { label: 'Still waiting', value: home.pod.pending },
                ]}
                format={count}
                empty="No trip has been delivered this month."
              />
            </>
          ) : (
            <ChartEmpty>The figures could not be read.</ChartEmpty>
          )}
          <CardLink href="/pod/pending">Open delivery proofs</CardLink>
        </ChartCard>

        {/* ---- targets ---- */}
        <ChartCard title="Targets this month" note={targets?.branchName ? `${targets.branchName} branch` : 'All branches together'} wide>
          {targets && targets.targets.length > 0 ? (
            <div className="viz-meters">
              {targets.targets.map((t) => (
                <Meter
                  key={t.metric}
                  emoji={TARGET_EMOJI[t.metric]}
                  label={TARGET_LABEL[t.metric]}
                  value={t.month.achieved}
                  of={t.month.target}
                  format={formatTarget(t.unit)}
                />
              ))}
            </div>
          ) : (
            <ChartEmpty>No targets to show.</ChartEmpty>
          )}
          <CardLink href="/admin/targets">Set targets</CardLink>
        </ChartCard>

        {/* ---- supply, people, and what is waiting ---- */}
        <ChartCard title="Transporters" note="By where their file stands">
          {vendors ? <HBars rows={vendorRows} format={count} empty="No transporter has been added yet." /> : <ChartEmpty>Transporters could not be read.</ChartEmpty>}
          <CardLink href="/vendors">Open Transporters</CardLink>
        </ChartCard>

        <ChartCard title="People by role" note="Everyone who can sign in today">
          {people ? <HBars rows={roleRows} format={count} empty="Nobody is allowed to sign in yet." /> : <ChartEmpty>The list of people could not be read.</ChartEmpty>}
          <CardLink href="/admin/users">Open Allowed emails</CardLink>
        </ChartCard>

        <ChartCard title="Approvals waiting" note="By what is being asked for">
          {approvals ? <HBars rows={approvalRows} format={count} empty="Nothing is waiting on a decision." /> : <ChartEmpty>Approvals could not be read.</ChartEmpty>}
          <CardLink href="/admin/approvals">Open Approvals</CardLink>
        </ChartCard>

        <ChartCard title="Tickets" note="Problems people have reported">
          {tickets ? (
            <HBars
              rows={[
                { label: 'Open', value: tickets.summary.open },
                { label: 'Being worked on', value: tickets.summary.inProgress },
                { label: 'Blocking somebody', value: tickets.summary.blocking, flag: tickets.summary.blocking ? 'urgent' : undefined },
              ]}
              format={count}
              empty="No ticket is open."
            />
          ) : (
            <ChartEmpty>Tickets could not be read.</ChartEmpty>
          )}
          <CardLink href="/tickets">Open Tickets</CardLink>
        </ChartCard>
      </div>
    </ModuleGuard>
  );
}

function CardLink({ href, children }: { href: string; children: string }) {
  return (
    <div className="viz-card-foot">
      <Link href={href}>{children} →</Link>
    </div>
  );
}

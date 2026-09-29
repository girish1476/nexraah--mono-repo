'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { errorMessage } from '@/apis';
import { fmtDate, inr, inrCompact } from '@/lib/format';
import { navFor } from '@/lib/permissions';
import { permissionsAtom, sessionAtom } from '@/store/atoms';
import {
  ActionCard,
  AllClear,
  Column,
  DataTable,
  ErrorState,
  Glyph,
  Loading,
  ModuleGuard,
  Panel,
  QuickLinks,
  SectionHead,
  Stack,
  StatStrip,
  Tag,
  Tone,
  useRole,
} from '@/lib/ui';
import { Issue } from '@/app/vendors/types';
import { getToday } from './apis';
import { FailureCause, TodayResponse } from './types';

const CAUSE_LABEL: Record<FailureCause, string> = {
  NO_QUOTE_AT_ALL: 'No transporter quoted at all',
  ONLY_ABOVE_BAND_QUOTES: 'Every quote came in above our price limit',
  IN_BAND_NONE_AWARDED: 'Quotes were within budget, but none was accepted',
  TRUCK_NEVER_REPORTED: 'Truck was booked but never turned up',
  CLIENT_CANCELLED: 'Client cancelled the load',
};

const SEVERITY_TONE: Record<Issue['severity'], Tone> = { LOW: 'grey', MEDIUM: 'flag', HIGH: 'red' };
const SEVERITY_LABEL: Record<Issue['severity'], string> = {
  LOW: 'Minor',
  MEDIUM: 'Needs attention',
  HIGH: 'Urgent',
};
const SEVERITY_EMOJI: Record<Issue['severity'], string> = { LOW: '🔵', MEDIUM: '⚠️', HIGH: '⛔' };

/** Before noon this reads as a greeting; after it, as a fact. Both are fine. */
function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * My desk — `/today` (part 10 §1).
 *
 * This screen used to be four tables stacked on a page. Every one of them was
 * accurate, and together they answered a question nobody arrives at work
 * with: "what rows exist". The question people actually have is "what do I
 * have to do, and which of it matters first" — so the page now opens with
 * that answer and keeps the tables underneath, where they belong, for the
 * working-through part.
 *
 * The shape is: one sentence at the top saying how today looks · one card per
 * pile of work, each naming the job and carrying the button that starts it ·
 * then the full lists.
 */
export default function TodayPage() {
  const session = useAtomValue(sessionAtom);
  const role = useRole();
  const permissions = useAtomValue(permissionsAtom);
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rendered on the client only. Reading the clock during a server render and
  // again on hydration gives two different greetings and a React mismatch.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);

  const load = () => {
    setError(null);
    getToday().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading your work" />;

  const firstName = (session?.name ?? '').split(' ')[0];
  const overduePods = data.podOverdue.rows.filter((r) => r.ageDays > 20).length;
  const urgentIssues = data.vendorIssues.rows.filter((r) => r.severity === 'HIGH').length;

  const waiting = data.pendingAllocation.rows.length;
  const failed = data.placementFailures.rows.length;
  const podsOut = data.podOverdue.rows.length;
  const issues = data.vendorIssues.rows.length;
  const total = waiting + failed + podsOut + issues;

  // The one line at the top. Naming the biggest pile beats a count of piles:
  // "7 things need you" is a number; "3 loads have no transporter" is a job.
  const headline =
    total === 0
      ? 'Nothing is waiting on you right now. Every load is placed, every delivery proof is in and no transporter has an open problem.'
      : failed > 0
        ? `Start with the ${failed} load${failed === 1 ? '' : 's'} we failed to place — that freight is already lost unless somebody re-opens it.`
        : waiting > 0
          ? `Start with the ${waiting} load${waiting === 1 ? '' : 's'} still waiting for a transporter.`
          : podsOut > 0
            ? `Start with the ${podsOut} delivery${podsOut === 1 ? '' : ' proofs'} we are still chasing — final payments are held until they are in.`
            : `Start with the ${issues} open transporter problem${issues === 1 ? '' : 's'}.`;

  // The same NAV the sidebar is built from, filtered the same way, so these
  // shortcuts can never offer a role a screen it is not allowed to open.
  const shortcuts = navFor(role, permissions)
    .flatMap((group) => group.items.map((item) => ({ ...item, area: group.area ?? 'desk' })))
    .filter((item) => item.note && item.href !== '/today')
    .slice(0, 6)
    .map((item) => ({
      href: item.href,
      emoji: item.emoji ?? '•',
      label: item.label,
      note: item.note,
      area: item.area,
    }));

  const allocationColumns: Column<TodayResponse['pendingAllocation']['rows'][number]>[] = [
    {
      key: 'client',
      label: 'Client and route',
      primary: true,
      render: (r) => r.clientName,
      // The code goes last, quietly. Nobody scans by it, but it is what
      // somebody reads out on the phone to the client — dropping it entirely
      // (which the first cut of this redesign did) makes the row unusable the
      // moment you need to talk to anyone about it.
      sub: (r) => `${r.lane} · ${r.weightTn} tonnes · ${r.truckType} · ${r.code}`,
    },
    { key: 'pickup', label: 'Pick up on', render: (r) => fmtDate(r.pickupDate) },
    { key: 'freight', label: 'Worth', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'quotes',
      label: 'Transporter quotes',
      render: (r) =>
        r.quoteCount ? (
          <Tag tone="mint" emoji="💬">
            {r.quoteCount} in
          </Tag>
        ) : (
          <Tag tone="red" emoji="🕸️" reason="Nobody has offered a price yet">
            None
          </Tag>
        ),
    },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    {
      key: 'go',
      label: '',
      render: (r) => (
        <Link href={`/indents/${r.id}`} className="btn btn-secondary btn-sm">
          Open
        </Link>
      ),
    },
  ];

  const failureColumns: Column<TodayResponse['placementFailures']['rows'][number]>[] = [
    {
      key: 'client',
      label: 'Client and route',
      primary: true,
      render: (r) => r.clientName,
      sub: (r) => `${r.lane} · was due ${fmtDate(r.pickupDate)} · ${r.branchName} · ${r.code}`,
    },
    { key: 'freight', label: 'Freight lost', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'cause',
      label: 'What went wrong',
      render: (r) => (
        <Tag tone={r.cause === 'ONLY_ABOVE_BAND_QUOTES' ? 'flag' : 'red'} emoji>
          {CAUSE_LABEL[r.cause] ?? r.cause}
        </Tag>
      ),
    },
    {
      key: 'go',
      label: '',
      render: (r) => (
        <Link href={`/indents/${r.id}`} className="btn btn-secondary btn-sm">
          Open
        </Link>
      ),
    },
  ];

  return (
    <ModuleGuard module="today">
      <div className="hero">
        <div style={{ minWidth: 0 }}>
          {/* An <h1>, not a styled div: this is the page's title, it is what a
              screen reader announces on arrival, and every screen in the
              console owes its reader one. */}
          <h1 className="hero-title">
            <Glyph size={30}>{total === 0 ? '🎉' : '👋'}</Glyph>
            {hour === null ? 'My desk' : `${greeting(hour)}${firstName ? `, ${firstName}` : ''}`}
          </h1>
          <div className="hero-sub">{headline}</div>
        </div>
        <div className="hero-figure">
          <div className="hero-figure-value">{total}</div>
          <div className="hero-figure-label">
            {total === 1 ? 'thing needs you' : 'things need you'}
          </div>
        </div>
      </div>

      <SectionHead
        emoji="📌"
        title="Today's action"
        note="In the order they cost us money"
      />

      <Stack gap={12}>
        {failed > 0 && (
          <ActionCard
            emoji="🚨"
            tone="red"
            count={failed}
            title={`load${failed === 1 ? '' : 's'} we could not put a vehicle on`}
            why={
              <>
                {inrCompact(data.placementFailures.stats.freightLostPaise)} of freight has already
                been missed.{' '}
                {data.placementFailures.stats.neverQuoted > 0 && (
                  <>
                    {data.placementFailures.stats.neverQuoted} of these never drew a single quote —
                    a lane nobody will price is a supply problem, not a pricing one.
                  </>
                )}
              </>
            }
            action={
              <>
                <a href="#failures" className="btn">
                  See the failed loads
                </a>
                <Link href="/vendors/market-gap" className="btn btn-secondary">
                  🚛 Find transporters for these lanes
                </Link>
              </>
            }
          />
        )}

        {waiting > 0 && (
          <ActionCard
            emoji="📝"
            tone={data.pendingAllocation.stats.noQuotes > 0 ? 'flag' : 'blue'}
            count={waiting}
            title={`load${waiting === 1 ? '' : 's'} still waiting for a transporter`}
            why={
              <>
                {inrCompact(data.pendingAllocation.stats.freightAtStakePaise)} of freight and{' '}
                {data.pendingAllocation.stats.tonnes} tonnes are riding on these.
                {data.pendingAllocation.stats.noQuotes > 0 &&
                  ` ${data.pendingAllocation.stats.noQuotes} of them have no quote at all yet.`}
                {data.pendingAllocation.stats.earliestPickup &&
                  ` The earliest pickup is ${fmtDate(data.pendingAllocation.stats.earliestPickup)}.`}
              </>
            }
            action={
              <a href="#waiting" className="btn">
                Place these loads
              </a>
            }
          />
        )}

        {podsOut > 0 && (
          <ActionCard
            emoji="📸"
            tone={overduePods > 0 ? 'red' : 'flag'}
            count={podsOut}
            title={`deliver${podsOut === 1 ? 'y is' : 'ies are'} still missing their signed paperwork`}
            why={
              <>
                The goods arrived, but the transporter has not sent back the signed delivery note —
                so their final payment stays locked and we cannot bill the client.
                {overduePods > 0 && ` ${overduePods} of these are over 20 days old.`}
              </>
            }
            action={
              <>
                <a href="#pods" className="btn">
                  Chase the paperwork
                </a>
                <Link href="/pod/receiving" className="btn btn-secondary">
                  📥 Log proof that has arrived
                </Link>
              </>
            }
          />
        )}

        {issues > 0 && (
          <ActionCard
            emoji="🛠️"
            tone={urgentIssues > 0 ? 'red' : 'flag'}
            count={issues}
            title={`open problem${issues === 1 ? '' : 's'} with transporters`}
            why={
              urgentIssues > 0
                ? `${urgentIssues} of these are marked urgent — an unresolved problem here usually turns into a failed pickup next week.`
                : 'Nothing urgent, but these are the complaints and disputes still on our books.'
            }
            action={
              <a href="#issues" className="btn btn-secondary">
                Review the problems
              </a>
            }
          />
        )}

        {total === 0 && (
          <AllClear emoji="🎉">
            <strong>Your desk is clear.</strong> Every load has a vehicle, every delivery proof is
            in, and no transporter has an open problem. Anything new will appear here on its own —
            you do not need to go looking.
          </AllClear>
        )}
      </Stack>

      <SectionHead emoji="⚡" title="Quick links" note="The screens this desk uses most" />
      <QuickLinks items={shortcuts} />

      {total > 0 && (
        <>
          <SectionHead
            emoji="📋"
            title="All shipments"
            note="Everything behind the cards above"
          />

          <Stack gap={20}>
            {failed > 0 && (
              <div id="failures">
                <StatStrip
                  stats={[
                    {
                      k: 'Loads not placed', id: 'today-failed',
                      v: data.placementFailures.stats.failed,
                      tone: 'red',
                      emoji: '🚨',
                      note: 'No vehicle went against these',
                    },
                    {
                      k: 'Freight missed', id: 'today-freight-lost',
                      v: inrCompact(data.placementFailures.stats.freightLostPaise),
                      tone: 'red',
                      emoji: '💸',
                      note: 'Revenue we did not earn',
                    },
                    {
                      k: 'Never quoted', id: 'today-never-quoted',
                      v: data.placementFailures.stats.neverQuoted,
                      emoji: '🕸️',
                      note: 'Not one transporter offered a price',
                    },
                  ]}
                />
                <div style={{ marginTop: 12 }}>
                  <Panel
                    title="🚨 Unassigned loads"
                    right={
                      <Link href="/vendors/market-gap" className="btn btn-secondary btn-sm">
                        Where we are short of trucks →
                      </Link>
                    }
                    pad={false}
                  >
                    <DataTable
                      columns={failureColumns}
                      rows={data.placementFailures.rows}
                      rowKey={(r) => r.id}
                      empty="No loads were missed."
                    />
                    <div
                      className="hint"
                      style={{ padding: '12px 15px', borderTop: '1px solid var(--color-divider)' }}
                    >
                      💡 A route that only ever draws quotes above our price limit is telling us we
                      do not have enough transporters on it. The answer is to recruit on that route
                      — not to raise the limit.
                    </div>
                  </Panel>
                </div>
              </div>
            )}

            {waiting > 0 && (
              <div id="waiting">
                <StatStrip
                  stats={[
                    {
                      k: 'Waiting for a vehicle', id: 'today-waiting',
                      v: data.pendingAllocation.stats.waiting,
                      emoji: '📝',
                      note: 'Client has booked, we have not placed',
                    },
                    {
                      k: 'Freight at stake', id: 'today-freight-at-stake',
                      v: inrCompact(data.pendingAllocation.stats.freightAtStakePaise),
                      emoji: '💰',
                      note: 'What these loads are worth to us',
                    },
                    {
                      k: 'No quotes yet', id: 'today-no-quotes',
                      v: data.pendingAllocation.stats.noQuotes,
                      tone: 'red',
                      emoji: '🕸️',
                      note: 'Nobody has offered a price',
                    },
                    {
                      k: 'Quotes in', id: 'today-quotes-in',
                      v: data.pendingAllocation.stats.quotesIn,
                      tone: 'mint',
                      emoji: '💬',
                      note: 'Ready for you to choose one',
                    },
                    {
                      k: 'Earliest pickup', id: 'today-earliest-pickup',
                      v: fmtDate(data.pendingAllocation.stats.earliestPickup),
                      emoji: '📅',
                      note: 'The one that runs out of time first',
                    },
                    {
                      k: 'Tonnes waiting', id: 'today-tonnes',
                      v: data.pendingAllocation.stats.tonnes,
                      emoji: '⚖️',
                      note: 'Total weight still to move',
                    },
                  ]}
                />
                <div style={{ marginTop: 12 }}>
                  <Panel title="📝 Awaiting transporter" pad={false}>
                    <DataTable
                      columns={allocationColumns}
                      rows={data.pendingAllocation.rows}
                      rowKey={(r) => r.id}
                      empty="Every load has a vehicle."
                    />
                  </Panel>
                </div>
              </div>
            )}

            {podsOut > 0 && (
              <div id="pods">
                <Panel title="📸 Missing documents" pad={false}>
                  <DataTable
                    columns={[
                      {
                        key: 'trip',
                        label: 'Transporter and route',
                        primary: true,
                        render: (r: TodayResponse['podOverdue']['rows'][number]) => r.vendorName,
                        sub: (r) => `${r.lane} · trip ${r.tripCode}`,
                      },
                      {
                        key: 'age',
                        label: 'Days waiting',
                        align: 'right',
                        render: (r) =>
                          r.ageDays > 20 ? (
                            <Tag tone="red" emoji="⏰">
                              {r.ageDays} days
                            </Tag>
                          ) : (
                            `${r.ageDays} days`
                          ),
                      },
                      {
                        key: 'held',
                        label: 'Their money we are holding',
                        align: 'right',
                        render: (r) => inr(r.balanceHeldPaise),
                      },
                      {
                        key: 'go',
                        label: '',
                        render: (r) => (
                          <Link href={`/trips/${r.tripId}`} className="btn btn-secondary btn-sm">
                            Open
                          </Link>
                        ),
                      },
                    ]}
                    rows={data.podOverdue.rows}
                    rowKey={(r) => r.tripId}
                    empty="Every delivery proof is in."
                  />
                  <div
                    className="hint"
                    style={{ padding: '12px 15px', borderTop: '1px solid var(--color-divider)' }}
                  >
                    💡 The amount on the right is the transporter&apos;s own final payment, held
                    until they send the signed delivery note. Saying that out loud when you call
                    them is usually enough.
                  </div>
                </Panel>
              </div>
            )}

            {issues > 0 && (
              <div id="issues">
                <Panel title="🛠️ Transporter issues" pad={false}>
                  <DataTable
                    columns={[
                      {
                        key: 'vendor',
                        label: 'Transporter',
                        primary: true,
                        render: (r: Issue) => r.vendorName,
                        sub: (r) => `${r.category.replace(/_/g, ' ').toLowerCase()} · ${r.code}`,
                      },
                      {
                        key: 'sev',
                        label: 'How bad',
                        render: (r) => (
                          <Tag tone={SEVERITY_TONE[r.severity]} emoji={SEVERITY_EMOJI[r.severity]}>
                            {SEVERITY_LABEL[r.severity]}
                          </Tag>
                        ),
                      },
                      {
                        key: 'note',
                        label: 'What happened',
                        render: (r) => <span className="muted">{r.note}</span>,
                      },
                    ]}
                    rows={data.vendorIssues.rows}
                    rowKey={(r) => r.id}
                    empty="No open problems."
                  />
                </Panel>
              </div>
            )}
          </Stack>
        </>
      )}
    </ModuleGuard>
  );
}

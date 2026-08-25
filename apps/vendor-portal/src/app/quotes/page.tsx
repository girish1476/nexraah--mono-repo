'use client';

import Link from 'next/link';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  EmptyState,
  ErrorNote,
  Loading,
  Pill,
  ScreenHeader,
  Segmented,
  TabBar,
} from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { QUOTE_TONE } from '@/lib/status';
import { QuoteFilter, quoteFilterAtom } from '@/store/atoms';
import { getQuotes, withdrawQuote } from './apis';
import { Quote, QuoteStatus } from './types';

const FILTERS = ['All', 'Open', 'Won', 'Lost'] as const;

/** Link styled as the one action inside an EmptyState; `.tap` keeps it 44px. */
const QUOTES_ACTION_STYLE: CSSProperties = {
  border: '1px solid var(--color-accent)',
  borderRadius: 'var(--radius-pill)',
  padding: '10px 18px',
  fontSize: 15,
  fontWeight: 700,
  textDecoration: 'none',
  color: 'var(--color-accent-700)',
};

const FILTER_STATUSES: Record<QuoteFilter, QuoteStatus[]> = {
  All: [],
  Open: ['SUBMITTED', 'PENDING_APPROVAL'],
  Won: ['WON'],
  Lost: ['LOST'],
};

const STATUS_LABEL: Record<QuoteStatus, string> = {
  SUBMITTED: 'Submitted',
  PENDING_APPROVAL: 'Pending approval',
  WON: 'Won',
  LOST: 'Lost',
  WITHDRAWN: 'Withdrawn',
};

/** One plain sentence per status — the bare word decides nothing for a driver. */
const STATUS_REASON: Record<QuoteStatus, string> = {
  SUBMITTED: 'Your price is with Nexraah. No answer yet.',
  PENDING_APPROVAL:
    'Your price is over the range for that load, so a Nexraah manager has to approve it before the load can be given to you.',
  WON: 'This load is yours. It is now a trip — open it from the Trips tab.',
  LOST: 'This load will not come to you. The reason is written below.',
  WITHDRAWN: 'You took this price back, so it is no longer being considered.',
};

/**
 * Redaction (BR-55/NFR-02): the reason is a fixed enum and the copy stays that
 * way — no price gap, no count of quotes, nothing about anyone else's price.
 * A softer "you were beaten on price" line is exactly what this app exists to
 * withhold.
 */
const LOST_NOTE: Record<NonNullable<Quote['lostReason']>, string> = {
  AWARDED_ELSEWHERE: 'This lane was awarded elsewhere. The load went to someone else.',
  INDENT_CANCELLED: 'The load was cancelled before it was given to anyone.',
  EXPIRED: 'The load closed before it was given to anyone.',
};

export default function QuotesPage() {
  const [filter, setFilter] = useAtom(quoteFilterAtom);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setQuotes(null);
    getQuotes(FILTER_STATUSES[filter])
      .then(setQuotes)
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(load, [load]);

  const withdraw = (id: string) => {
    withdrawQuote(id).then(load).catch((e) => setError(e.message));
  };

  return (
    <main className="screen">
      <ScreenHeader
        title="My quotes"
        sub={`Showing: ${filter}`}
        what="Every price you have sent, and what came of it. Won means the load is yours — open it from the Trips tab."
      />

      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={(f) => setFilter(f as QuoteFilter)}
        />
      </div>

      {error && <ErrorNote message={error} />}
      {!quotes && !error && <Loading />}
      {quotes?.length === 0 &&
        (filter === 'All' ? (
          <EmptyState
            title="You have not sent any prices yet"
            what="Every price you send for a load will sit here, with what happened to it — waiting, won or lost."
            next="Open the Loads tab, pick a load that suits your truck, and send your price."
            action={
              <Link href="/loads" className="tap" style={QUOTES_ACTION_STYLE}>
                Go to Loads
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={`Nothing under ${filter} right now`}
            what={
              filter === 'Open'
                ? 'Prices you have sent that are still waiting for an answer show up here.'
                : filter === 'Won'
                  ? 'Loads that were given to you show up here. Each one also becomes a trip.'
                  : 'Prices that did not get the load show up here, each with its reason.'
            }
            next="Tap All to see every quote you have sent."
          />
        ))}

      {quotes?.map((q) => (
        <div key={q.id} className="card">
          <div className="row-between">
            <span className="card-title">
              {q.originCity} → {q.destinationCity}
            </span>
            <Pill tone={QUOTE_TONE[q.status]} reason={STATUS_REASON[q.status]}>
              {STATUS_LABEL[q.status]}
            </Pill>
          </div>
          <p className="muted">
            Load {q.loadCode} · you sent this price on {dateTime(q.submittedAt)}
          </p>
          <div className="row-between" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              You quoted {inr(q.amountPaise)}
            </span>
            {q.tripId && (
              <Link href={`/trips/${q.tripId}`} className="tap" style={{ fontSize: 15, fontWeight: 700 }}>
                Open trip {q.tripId}
              </Link>
            )}
          </div>

          {q.status === 'PENDING_APPROVAL' && q.aboveBandByPaise !== null && (
            <p className="muted" style={{ marginTop: 6 }}>
              Your price is {inr(q.aboveBandByPaise)} above the top of the range for this load.
              Nothing is wrong — it just has to be approved first.
            </p>
          )}
          {q.status === 'LOST' && q.lostReason && (
            <>
              <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5 }}>
                {LOST_NOTE[q.lostReason]}
              </p>
              <p className="muted" style={{ marginTop: 4 }}>
                This is the whole reason. Nothing more is recorded about this quote, so there is
                nothing left to chase — go to Loads and quote the next one.
              </p>
            </>
          )}
          {q.status === 'SUBMITTED' && (
            <>
              <button
                onClick={() => withdraw(q.id)}
                className="tap"
                style={{
                  marginTop: 10,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--red)',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                Withdraw quote
              </button>
              <p className="muted" style={{ marginTop: 2 }}>
                Takes your price out of the running for this load. Use it if your truck is no
                longer free.
              </p>
            </>
          )}
        </div>
      ))}

      <TabBar />
    </main>
  );
}

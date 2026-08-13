'use client';

import Link from 'next/link';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Loading, Pill, ScreenHeader, Segmented, TabBar } from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { QUOTE_TONE } from '@/lib/status';
import { QuoteFilter, quoteFilterAtom } from '@/store/atoms';
import { getQuotes, withdrawQuote } from './apis';
import { Quote, QuoteStatus } from './types';

const FILTERS = ['All', 'Open', 'Won', 'Lost'] as const;

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

const LOST_NOTE: Record<NonNullable<Quote['lostReason']>, string> = {
  AWARDED_ELSEWHERE: 'This lane was awarded elsewhere.',
  INDENT_CANCELLED: 'The client cancelled the load.',
  EXPIRED: 'The load closed before it was awarded.',
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
      <ScreenHeader title="My quotes" sub="Everything you have priced this week" />

      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={(f) => setFilter(f as QuoteFilter)}
        />
      </div>

      {error && <ErrorNote message={error} />}
      {!quotes && !error && <Loading />}
      {quotes?.length === 0 && <p className="muted">Nothing here yet.</p>}

      {quotes?.map((q) => (
        <div key={q.id} className="card">
          <div className="row-between">
            <span className="card-title">
              {q.originCity} → {q.destinationCity}
            </span>
            <Pill tone={QUOTE_TONE[q.status]}>{STATUS_LABEL[q.status]}</Pill>
          </div>
          <p className="muted">
            {q.loadCode} · quoted {dateTime(q.submittedAt)}
          </p>
          <div className="row-between" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{inr(q.amountPaise)}</span>
            {q.tripId && (
              <Link href={`/trips/${q.tripId}`} style={{ fontSize: 13 }}>
                Open trip {q.tripId}
              </Link>
            )}
          </div>

          {q.status === 'PENDING_APPROVAL' && q.aboveBandByPaise !== null && (
            <p className="muted" style={{ marginTop: 6 }}>
              Above band by {inr(q.aboveBandByPaise)} — waiting on approval before it can be
              awarded.
            </p>
          )}
          {q.status === 'LOST' && q.lostReason && (
            <p className="muted" style={{ marginTop: 6 }}>
              {LOST_NOTE[q.lostReason]}
            </p>
          )}
          {q.status === 'SUBMITTED' && (
            <button
              onClick={() => withdraw(q.id)}
              style={{
                marginTop: 10,
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--red)',
                fontSize: 13,
              }}
            >
              Withdraw quote
            </button>
          )}
        </div>
      ))}

      <TabBar />
    </main>
  );
}

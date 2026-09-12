'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  EmptyState,
  ErrorState,
  Glyph,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  SectionHead,
  Tag,
  useLevel,
} from '@/lib/ui';
import { KIND_EMOJI, KIND_LABEL, KIND_MODULE, SearchHit, SearchKind } from './types';
import { searchEverywhere } from './apis';

const KINDS: SearchKind[] = ['order', 'trip', 'indent', 'client', 'vendor', 'invoice'];

/**
 * `/search` — one box that finds anything.
 *
 * This replaces two sidebar rows at the owner's direction. "All shipments"
 * found a load and "Trips on the road" found a trip, which meant knowing which
 * of the two a code belonged to *before* you could look it up — and a person
 * holding a lorry receipt in their hand does not know whether the thing they
 * want is filed as an order, a trip or a load request. One box, every record,
 * grouped by what it turned out to be.
 *
 * It is one of the three screens common to every desk, so it has no permission
 * of its own. What it *finds* still obeys the module matrix: a hit is only
 * listed if the signed-in role can open the screen behind it, because offering
 * somebody a result that refuses them is worse than not finding it.
 */
export default function SearchPage() {
  const [term, setTerm] = useState('');
  const [kinds, setKinds] = useState<SearchKind[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Module levels are hooks, so they are read once here rather than inside the
  // filter below.
  const levels: Record<SearchKind, string> = {
    order: useLevel('orders'),
    trip: useLevel('trips'),
    indent: useLevel('indents'),
    client: useLevel('clients'),
    vendor: useLevel('vendors'),
    invoice: useLevel('invoices'),
  };

  const allowed = useMemo(() => KINDS.filter((k) => levels[k] !== 'NONE'), [levels]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setHits(null);
      setBusy(false);
      return;
    }
    /*
     * 300ms after the last keystroke, not on every one. Each search is six
     * requests; firing them per character would put thirty in flight for a
     * five-letter code and answer with whichever came back last.
     */
    setBusy(true);
    const timer = setTimeout(() => {
      setError(null);
      searchEverywhere(q, kinds.length ? kinds : allowed)
        .then((rows) => setHits(rows.filter((r) => levels[r.kind] !== 'NONE')))
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, kinds, allowed]);

  const toggle = (k: SearchKind) =>
    setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);

  const grouped = useMemo(() => {
    const by = new Map<SearchKind, SearchHit[]>();
    for (const hit of hits ?? []) {
      by.set(hit.kind, [...(by.get(hit.kind) ?? []), hit]);
    }
    return [...by.entries()];
  }, [hits]);

  if (error) return <ErrorState message={error} retry={() => setTerm((t) => t)} />;

  return (
    <ModuleGuard module="search">
      <PageHeader
        title="Global search"
        sub="One box for every record — loads, trips, load requests, clients, transporters and bills"
        module="search"
      />
      <PageIntro
        what="Type any code or name — a lorry receipt, an order number, a truck number, a company. Anything matching comes back grouped by what it is."
        who="Everyone. You only see what your job lets you open."
      >
        This is where the old “All shipments” and “Trips on the road” screens went. Knowing whether
        the number in your hand belongs to a load, a trip or a bill was never the point — finding
        it was.
      </PageIntro>

      <Panel>
        <div className="field">
          <label htmlFor="global-search">What are you looking for?</label>
          <input
            id="global-search"
            ref={inputRef}
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="LR number, order number, truck number, client or transporter name…"
            autoComplete="off"
          />
          <span className="muted" style={{ fontSize: 11 }}>
            Two letters or more. Partial codes work — “4471” finds IND-4471.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {allowed.map((k) => {
            const on = kinds.includes(k);
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                className={on ? 'btn btn-sm' : 'btn btn-secondary btn-sm'}
                aria-pressed={on}
              >
                {KIND_EMOJI[k]} {KIND_LABEL[k]}
              </button>
            );
          })}
          {kinds.length > 0 && (
            <button onClick={() => setKinds([])} className="btn btn-ghost btn-sm">
              Search everything
            </button>
          )}
        </div>
      </Panel>

      {busy && <Loading what="Searching" />}

      {!busy && hits !== null && hits.length === 0 && (
        <EmptyState
          emoji="🔎"
          title={`Nothing matches “${term.trim()}”`}
          hint="Check the code, or try part of it — a client name or a truck number works as well as a reference."
        />
      )}

      {!busy &&
        grouped.map(([kind, rows]) => (
          <div key={kind}>
            <SectionHead
              emoji={KIND_EMOJI[kind]}
              title={`${KIND_LABEL[kind]}${rows.length === 1 ? '' : 's'}`}
              note={`${rows.length} match${rows.length === 1 ? '' : 'es'}`}
            />
            <Panel pad={false}>
              {rows.map((hit) => (
                <Link
                  key={`${hit.kind}-${hit.href}`}
                  href={hit.href}
                  className="search-hit"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '13px 16px',
                    borderTop: '1px solid var(--color-divider)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <Glyph size={17}>{KIND_EMOJI[hit.kind]}</Glyph>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, display: 'block' }}>{hit.title}</span>
                    <span className="hint" style={{ display: 'block' }}>
                      {hit.code} · {hit.detail}
                    </span>
                  </span>
                  {hit.state && (
                    <Tag tone="blue" emoji="•">
                      {hit.state}
                    </Tag>
                  )}
                </Link>
              ))}
            </Panel>
          </div>
        ))}

      {hits === null && !busy && (
        <EmptyState
          emoji="⌨️"
          title="Start typing"
          hint="Every load, trip, load request, client, transporter and bill you can open is searchable from here."
        />
      )}
    </ModuleGuard>
  );
}

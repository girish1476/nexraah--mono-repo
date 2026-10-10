'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { errorMessage, request } from '@/apis';

interface Source {
  label: string;
  /** A path in the console. */
  href: string;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** The records an answer was read from, to open and check. */
  sources?: Source[];
  /** A turn that is a failure notice, not an answer — shown, but never sent back as conversation. */
  failed?: boolean;
}

/**
 * POST /assistant/chat — the conversation so far, ending with the question.
 * The server answers only from records it looks up as the signed-in person,
 * and returns the screens those records are on.
 */
function ask(messages: { role: 'user' | 'assistant'; content: string }[]) {
  return request<{ answer: string; sources: Source[] }>({ url: '/assistant/chat', method: 'POST', data: { messages } });
}

const STARTERS = [
  'Which loads are still waiting for a truck?',
  'Which final payments are ready to release?',
  'How do I correct a wrong truck number?',
];

/** The server keeps nothing between questions, so only the recent turns are sent with each one. */
const SENT_TURNS = 12;

/**
 * The assistant — a button in the corner of every screen that opens a small
 * chat. It answers questions about orders, trucks, transporters, documents and
 * payments from the live records, and about how to do things in the console.
 *
 * It only reads. Every answer lists the screens its records came from, so a
 * figure can be checked before anybody acts on it — which is the point: this
 * is a quicker way to the record, not a replacement for it.
 *
 * The conversation lives in this component and is gone on reload; nothing is
 * stored on the server.
 */
export function Assistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Keep the newest turn in view, and the cursor in the box while it is open.
  useEffect(() => {
    if (!open) return;
    end.current?.scrollIntoView({ block: 'end' });
    if (!busy) input.current?.focus();
  }, [open, turns, busy]);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    try {
      const reply = await ask(
        next
          .filter((t) => !t.failed)
          .slice(-SENT_TURNS)
          .map(({ role, content }) => ({ role, content })),
      );
      setTurns([...next, { role: 'assistant', content: reply.answer, sources: reply.sources }]);
    } catch (e) {
      setTurns([...next, { role: 'assistant', content: errorMessage(e), failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="assistant no-print">
      {open && (
        <section className="assistant-panel surface" aria-label="Assistant">
          <header className="assistant-head">
            <div>
              <strong>Ask Nexraah</strong>
              <div className="muted" style={{ fontSize: 11.5 }}>
                Quick answers from the records in this console. Check the linked screen before acting on one.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {turns.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setTurns([])} disabled={busy}>
                  Clear
                </button>
              )}
              <button className="btn btn-ghost btn-sm" aria-label="Close the assistant" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
          </header>

          <div className="assistant-turns" aria-live="polite">
            {turns.length === 0 && (
              <div>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                  Ask about anything in the console — orders, trucks, transporters, clients and rates, payments,
                  bills, approvals, targets — or how to do something here. I can look things up; I cannot change
                  anything.
                </p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {STARTERS.map((s) => (
                    <button key={s} className="btn btn-secondary btn-sm assistant-starter" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={`assistant-turn is-${t.role}${t.failed ? ' is-failed' : ''}`}>
                <div className="assistant-bubble">{t.content}</div>
                {t.sources && t.sources.length > 0 && (
                  <div className="assistant-sources">
                    <span className="muted">From:</span>
                    {t.sources.map((s) => (
                      <Link key={s.href} href={s.href}>
                        {s.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="assistant-turn is-assistant">
                <div className="assistant-bubble muted">Looking that up…</div>
              </div>
            )}
            <div ref={end} />
          </div>

          <form className="assistant-form" onSubmit={onSubmit}>
            <textarea
              ref={input}
              rows={2}
              value={draft}
              maxLength={2000}
              placeholder="e.g. Where is truck AP39EW3699?"
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a new line.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button className="btn btn-sm" type="submit" disabled={busy || !draft.trim()}>
              Ask
            </button>
          </form>
        </section>
      )}

      <button
        className="assistant-toggle"
        aria-expanded={open}
        // A name no other control shares a word with: tests and screen-reader
        // users both find buttons by name, and "Open" is on half the tables.
        aria-label="Assistant"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>💬</span> Ask
      </button>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime } from '@/lib/format';
import { useToast } from '@/lib/ui';
import { addOrderComment } from '../apis';
import type { OrderComment } from '../types';

/**
 * Comments on an order, behind a small 💬 button in the page header.
 *
 * It used to be a whole tab that could only show the remarks typed when the
 * load was raised. Operations asked for a small icon where remarks and details
 * can actually be entered as the load moves. The button carries the count, so
 * a note is noticed without opening anything; the panel lists the original
 * special instructions first, then every comment, oldest first, and takes a
 * new one at the bottom. Comments are append-only — a note of what was said
 * at the time is never rewritten.
 */
export function OrderCommentsButton({
  orderId,
  remarks,
  initial,
}: {
  orderId: string;
  remarks: string | null;
  initial: OrderComment[];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<OrderComment[]>(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setComments(initial), [initial]);
  // While the panel is open the page behind it does not scroll — on a phone a
  // scrolled page slid the panel's header off screen and taps missed the button.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const before = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = before.html;
      document.body.style.overflow = before.body;
    };
  }, [open]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, comments.length]);

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      setComments(await addOrderComment(orderId, body));
      setText('');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const count = comments.length + (remarks ? 1 : 0);

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen(true)}
        title="Comments and remarks on this order"
        aria-label={`Comments (${count})`}
        style={{ position: 'relative', paddingInline: 12 }}
      >
        <span aria-hidden>💬</span>
        {count > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              padding: '0 5px',
              background: 'var(--flag)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: '18px',
              textAlign: 'center',
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'color-mix(in srgb, #0B1D3D 45%, transparent)',
          }}
        >
          <aside
            role="dialog"
            aria-label="Comments on this order"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(420px, 100vw)',
              height: '100%',
              background: 'var(--color-surface)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--color-divider)' }}>
              <strong style={{ flex: 1 }}>💬 Comments</strong>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {remarks && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--color-surface-sunken)' }}>
                  <div className="eyebrow">Special instructions · when the load was raised</div>
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{remarks}</div>
                </div>
              )}
              {comments.map((c) => (
                <div key={c.id}>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {c.authorName} · {fmtDateTime(c.at)}
                  </div>
                  <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))}
              {!remarks && comments.length === 0 && (
                <div className="muted" style={{ fontSize: 12.5 }}>
                  No comments yet. Add a remark or a detail below — who called, what was agreed, anything the next
                  person on this order should know.
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div style={{ flex: 'none', padding: 16, borderTop: '1px solid var(--color-divider)' }}>
              {/* Block, border-box and a fixed height: on a phone the box used to
                  spill over the Add comment button below it and swallow its taps. */}
              <textarea
                rows={3}
                placeholder="Add a remark or detail…"
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
                }}
                style={{ display: 'block', width: '100%', boxSizing: 'border-box', height: 84, minHeight: 0, resize: 'none' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 8,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <span className="muted" style={{ fontSize: 11 }}>
                  Ctrl + Enter to add · comments cannot be edited
                </span>
                <button type="button" className="btn btn-sm" disabled={busy || !text.trim()} onClick={add}>
                  Add comment
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

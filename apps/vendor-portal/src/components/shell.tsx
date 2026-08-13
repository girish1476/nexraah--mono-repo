'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

export type Tone = 'mint' | 'flag' | 'red' | 'blue' | 'grey';

export const toneStyle = (t: Tone) => ({
  background: `var(--${t}-t)`,
  color: `var(--${t})`,
});

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="pill" style={toneStyle(tone)}>
      {children}
    </span>
  );
}

/**
 * Tinted block for state that needs reading — blocked advance, POD clock,
 * rejection, verdict. Every screen uses this, so a tint means the same thing
 * everywhere and no page invents its own.
 */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="card" style={{ background: `var(--${tone}-t)`, borderColor: 'transparent' }}>
      <p style={{ color: `var(--${tone})`, fontWeight: 600 }}>{title}</p>
      {children && <div style={{ fontSize: 13, marginTop: 4 }}>{children}</div>}
    </div>
  );
}

export function ScreenHeader({
  title,
  sub,
  back,
  right,
}: {
  title: string;
  sub?: string;
  back?: string;
  right?: ReactNode;
}) {
  const router = useRouter();
  return (
    <header style={{ padding: '8px 0 16px' }}>
      {back && (
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-accent-700)',
            fontSize: 13,
            padding: '4px 0',
          }}
        >
          ← {back}
        </button>
      )}
      <div className="row-between">
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 26,
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        {right}
      </div>
      {sub && <p className="muted">{sub}</p>}
    </header>
  );
}

/** Sticky primary action, mirrors the prototype action bar. */
export function ActionBar({
  label,
  note,
  disabled,
  onClick,
}: {
  label: string;
  note?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'var(--tab-h)',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-divider)',
        padding: 12,
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button
          onClick={onClick}
          disabled={disabled}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: 10,
            padding: '14px 12px',
            fontWeight: 600,
            background: disabled ? 'var(--color-neutral-300)' : 'var(--color-accent)',
            color: disabled ? 'var(--color-neutral-700)' : '#fff',
          }}
        >
          {label}
        </button>
        {note && (
          <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

/** Four is the ceiling on a phone (part 03); Profile lives in the header (part 08 §1). */
const TABS: [string, string][] = [
  ['/loads', 'Loads'],
  ['/quotes', 'Quotes'],
  ['/trips', 'Trips'],
  ['/fleet', 'Fleet'],
];

/** Header account link — the Profile entry point. */
export function AccountLink() {
  return (
    <Link
      href="/profile"
      style={{
        fontSize: 13,
        textDecoration: 'none',
        color: 'var(--color-accent-700)',
        border: '1px solid var(--color-divider)',
        background: 'var(--color-surface)',
        borderRadius: 999,
        padding: '6px 12px',
      }}
    >
      Profile
    </Link>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 'var(--tab-h)',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-divider)',
        display: 'flex',
      }}
    >
      {TABS.map(([href, label]) => {
        const active = path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              textDecoration: 'none',
              color: active ? 'var(--color-accent-700)' : 'var(--color-neutral-700)',
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Segmented single-choice control (reporting rule, quote filters). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 13,
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-divider)'}`,
              background: on ? 'var(--color-accent)' : 'transparent',
              color: on ? '#fff' : 'var(--color-text)',
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <div className="card">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className="row-between"
          style={{
            padding: '9px 0',
            borderTop: i ? '1px solid var(--color-divider)' : 'none',
          }}
        >
          <span className="muted">{k}</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return <Callout tone="red" title={message} />;
}

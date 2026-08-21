'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

export type Tone = 'mint' | 'flag' | 'red' | 'blue' | 'grey';

export const toneStyle = (t: Tone) => ({
  background: `var(--${t}-t)`,
  color: `var(--${t})`,
});

/* ---- icons ---------------------------------------------------------------
   One glyph per tab, drawn to a shared 24x24/1.9-stroke convention. No icon
   dependency for four shapes — keeps the bundle (and offline installs) light. */

function IconBase({ size = 21, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const TAB_ICONS: Record<string, ReactNode> = {
  '/loads': (
    <>
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
      <path d="M4 8.5 12 13l8-4.5M12 13v7" />
    </>
  ),
  '/quotes': (
    <>
      <path d="M3.5 4.5 20 11l-6.7 2.3L11 20 3.5 4.5Z" />
    </>
  ),
  '/trips': (
    <>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="17" r="2.2" />
      <path d="M8 8.2c1 1.6 2.6 1.7 4 1.5 3-.4 4.4.6 5 2.6" strokeDasharray="1 3.2" />
    </>
  ),
  '/fleet': (
    <>
      <path d="M3 16V7a1 1 0 0 1 1-1h9v10" />
      <path d="M13 10h4l3 3.2V16h-7" />
      <circle cx="7.5" cy="17.5" r="1.7" />
      <circle cx="16.5" cy="17.5" r="1.7" />
    </>
  ),
  '/profile': (
    <>
      <circle cx="12" cy="8.3" r="3.3" />
      <path d="M5.5 20c1-3.6 3.9-5.5 6.5-5.5s5.5 1.9 6.5 5.5" />
    </>
  ),
};

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
    <header style={{ padding: '8px 0 18px' }}>
      {back && (
        <button
          onClick={() => router.back()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: 'var(--color-accent-700)',
            fontWeight: 600,
            fontSize: 13,
            padding: '4px 0 8px',
            margin: '-4px 0 0',
          }}
        >
          <IconBase size={15}>
            <path d="M14.5 5 8 12l6.5 7" />
          </IconBase>
          {back}
        </button>
      )}
      <div className="row-between">
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 25,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h1>
        {right}
      </div>
      {sub && (
        <p className="muted" style={{ marginTop: 3 }}>
          {sub}
        </p>
      )}
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
        boxShadow: 'var(--shadow-lg)',
        padding: 12,
        zIndex: 20,
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button
          onClick={onClick}
          disabled={disabled}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '15px 12px',
            fontSize: 15,
            fontWeight: 700,
            background: disabled ? 'var(--color-neutral-300)' : 'var(--color-accent)',
            backgroundImage: disabled
              ? 'none'
              : 'linear-gradient(180deg, color-mix(in srgb, white 10%, var(--color-accent)), var(--color-accent))',
            color: disabled ? 'var(--color-neutral-700)' : '#fff',
            boxShadow: disabled ? 'none' : 'var(--shadow-sm)',
          }}
        >
          {label}
        </button>
        {note && (
          <p className="muted" style={{ textAlign: 'center', marginTop: 7 }}>
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        color: 'var(--color-accent-700)',
        border: '1px solid var(--color-divider)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-pill)',
        padding: '6px 13px 6px 10px',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow var(--transition-fast), transform var(--transition-fast)',
      }}
    >
      <IconBase size={14}>{TAB_ICONS['/profile']}</IconBase>
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
        boxShadow: '0 -1px 8px rgba(15, 30, 60, 0.05)',
        display: 'flex',
        zIndex: 20,
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
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              textDecoration: 'none',
              color: active ? 'var(--color-accent-700)' : 'var(--color-neutral-700)',
              transition: 'color var(--transition-fast)',
            }}
          >
            <IconBase size={20}>{TAB_ICONS[href]}</IconBase>
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
              borderRadius: 'var(--radius-pill)',
              padding: '7px 15px',
              fontSize: 13,
              fontWeight: on ? 700 : 500,
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-divider)'}`,
              background: on ? 'var(--color-accent)' : 'var(--color-surface)',
              color: on ? '#fff' : 'var(--color-text)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none',
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 10px' }} aria-busy="true">
      <div className="skeleton" style={{ height: 78, width: '100%' }} />
      <div className="skeleton" style={{ height: 78, width: '100%' }} />
      <div className="skeleton" style={{ height: 78, width: '70%' }} />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <Callout tone="red" title={message} />;
}

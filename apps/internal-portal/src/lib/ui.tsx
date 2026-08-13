'use client';

import { ReactNode, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { permissionsAtom, roleAtom, toastAtom } from '@/store/atoms';
import { Level, ModuleKey, MODULE_LABEL, Permission, ROLES, RoleCode, levelFor } from './permissions';
import { UnmetCondition } from '@/apis';

/* ---- tone ---------------------------------------------------------------
   Every state pill, figure and panel in the console uses one of five tones.
   Adding a sixth means adding it to the token block in globals.css first. */

export type Tone = 'mint' | 'flag' | 'red' | 'blue' | 'grey';

export function toneVars(tone: Tone): { background: string; color: string } {
  return { background: `var(--${tone}-tint)`, color: `var(--${tone})` };
}

export function toneInk(tone: Tone): string {
  return `var(--${tone})`;
}

/* ---- permission hooks --------------------------------------------------- */

export function useCan(): (permission: Permission) => boolean {
  const permissions = useAtomValue(permissionsAtom);
  return useCallback((permission: Permission) => permissions.includes(permission), [permissions]);
}

export function useRole(): RoleCode {
  return useAtomValue(roleAtom);
}

/** VIEW means the screen renders but every mutating control is withheld. */
export function useLevel(module: ModuleKey): Level {
  const role = useRole();
  return levelFor(module, role);
}

export function useToast(): (message: string) => void {
  const setToast = useSetAtom(toastAtom);
  return useCallback(
    (message: string) => {
      setToast(message);
      setTimeout(() => setToast(''), 3600);
    },
    [setToast],
  );
}

/* ---- chrome ------------------------------------------------------------- */

export function PageHeader({
  path,
  title,
  sub,
  right,
  module,
}: {
  path: string;
  title: string;
  sub?: string;
  right?: ReactNode;
  module?: ModuleKey;
}) {
  const role = useRole();
  const readOnly = module ? levelFor(module, role) === 'VIEW' : false;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 20,
        flexWrap: 'wrap',
        marginBottom: 18,
      }}
    >
      <div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--color-accent-700)' }}>
          {path}
        </div>
        <h1 style={{ marginTop: 3 }}>{title}</h1>
        {sub && (
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {sub}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {readOnly && (
          <span className="surface muted" style={{ fontSize: 12, padding: '8px 12px' }}>
            Read-only for {role}
          </span>
        )}
        {right}
      </div>
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  pad = true,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <div className="surface">
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 15px',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          {right}
        </div>
      )}
      <div style={pad ? { padding: 15 } : undefined}>{children}</div>
    </div>
  );
}

export function Tag({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="tag" style={toneVars(tone)}>
      {children}
    </span>
  );
}

export function Banner({
  tone,
  title,
  children,
  right,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${toneInk(tone)}33`,
        background: `var(--${tone}-tint)`,
        padding: '13px 15px',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 17, color: toneInk(tone) }}>
          {title}
        </div>
        {children && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {children}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

export interface Stat {
  k: string;
  v: ReactNode;
  note?: string;
  tone?: Tone;
}

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-strip">
      {stats.map((s) => (
        <div key={s.k}>
          <div className="eyebrow">{s.k}</div>
          <div className="stat-value" style={{ color: s.tone ? toneInk(s.tone) : 'var(--color-text)' }}>
            {s.v}
          </div>
          {s.note && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
              {s.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function FactList({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <div>
      {facts.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 14px',
            borderBottom: '1px solid color-mix(in srgb, var(--color-text) 7%, transparent)',
          }}
        >
          <span className="muted" style={{ fontSize: 11.5 }}>
            {k}
          </span>
          <span className="mono" style={{ fontSize: 12.5, textAlign: 'right' }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---- table --------------------------------------------------------------
   `data-label` on every cell is what lets globals.css collapse the table to
   cards below 768px (NFR-06). Do not hand-roll a <table> without it. */

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  mono?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  empty = 'Nothing here.',
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="muted" style={{ padding: '28px 14px', textAlign: 'center', fontSize: 12.5 }}>
        {empty}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={onRowClick ? 'row-tap' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.label}
                  className={c.align === 'right' || c.mono ? 'num' : undefined}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- the blocked panel --------------------------------------------------
   Part 01 §2.2, third pattern: the control is rendered, disabled, with the
   checklist of what would unblock it. The list comes from the server's 409
   or from the gate endpoint — never computed here. */

export function BlockedPanel({
  title,
  subtitle,
  unmet,
  cleared,
  action,
  note,
}: {
  title: string;
  subtitle?: ReactNode;
  unmet: UnmetCondition[];
  cleared?: { key: string; label: string }[];
  action?: ReactNode;
  note?: string;
}) {
  const blocked = unmet.length > 0;
  const tone: Tone = blocked ? 'red' : 'mint';
  return (
    <div style={{ border: `1px solid ${toneInk(tone)}33`, background: `var(--${tone}-tint)` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '13px 15px',
          borderBottom: `1px solid ${toneInk(tone)}22`,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 18, color: toneInk(tone) }}>
            {blocked ? `🔒 ${title}` : title}
          </div>
          {subtitle && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 1 }}>
              {subtitle}
            </div>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: '8px 15px 13px' }}>
        {unmet.map((u) => (
          <div key={u.key} style={{ display: 'flex', gap: 9, padding: '6px 0', fontSize: 13 }}>
            <span style={{ color: 'var(--red)' }}>✗</span>
            <span style={{ flex: 1 }}>{u.label}</span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {u.state === 'MISSING' ? 'not uploaded' : u.state.toLowerCase()}
            </span>
          </div>
        ))}
        {(cleared ?? []).map((c) => (
          <div key={c.key} className="muted" style={{ display: 'flex', gap: 9, padding: '6px 0', fontSize: 13 }}>
            <span style={{ color: 'var(--mint)' }}>✓</span>
            <span style={{ flex: 1 }}>{c.label}</span>
          </div>
        ))}
        {note && (
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 10 }}>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- dialog -------------------------------------------------------------- */

export function Dialog({
  open,
  title,
  body,
  facts,
  confirmLabel,
  confirmDisabled,
  busy,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  facts?: [string, ReactNode][];
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'color-mix(in srgb, #0B1D3D 55%, transparent)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface"
        style={{ width: 480, maxWidth: '100%', padding: '22px 24px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 style={{ fontSize: 22 }}>{title}</h2>
        {body && (
          <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 9 }}>
            {body}
          </div>
        )}
        {facts && facts.length > 0 && (
          <div style={{ border: '1px solid var(--color-divider)', marginTop: 14 }}>
            <FactList facts={facts} />
          </div>
        )}
        {children && <div style={{ marginTop: 14, display: 'grid', gap: 11 }}>{children}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const [toast] = useAtom(toastAtom);
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 26,
        transform: 'translateX(-50%)',
        zIndex: 90,
        padding: '11px 16px',
        background: 'var(--color-accent-900)',
        color: '#F0F3F8',
        fontSize: 13,
      }}
    >
      {toast}
    </div>
  );
}

/* ---- fields -------------------------------------------------------------- */

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className={required ? 'req' : undefined}>{label}</label>
      {children}
      {hint && !error && (
        <span className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 13,
        gridTemplateColumns: `repeat(auto-fit, minmax(${cols === 1 ? '100%' : '220px'}, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

/* ---- states -------------------------------------------------------------- */

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <div className="muted" style={{ padding: 28, fontSize: 13 }}>
      {what}…
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div style={{ border: '1px solid var(--red)', background: 'var(--red-tint)', padding: '13px 15px' }}>
      <div style={{ color: 'var(--red)', fontWeight: 600, fontSize: 14 }}>Could not load this screen</div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
        {message}
      </div>
      {retry && (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Direct URL to a module the role lacks — a lock panel naming the owner. */
export function ModuleLock({ module }: { module: ModuleKey }) {
  const role = useRole();
  const owners = (Object.keys(ROLES) as RoleCode[]).filter((r) => levelFor(module, r) === 'EDIT');
  return (
    <div className="surface" style={{ padding: 24, maxWidth: 560 }}>
      <h2>🔒 {MODULE_LABEL[module]}</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        {MODULE_LABEL[module]} is not part of the {ROLES[role].label} console.
        {owners.length > 0 && ` It belongs to ${owners.join(', ')}.`}
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        The server refuses the underlying requests as well — this panel is the presentation of that rule, not
        the rule itself.
      </p>
    </div>
  );
}

/** Wraps a page body so a lacking role gets the lock panel, not a broken screen. */
export function ModuleGuard({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const level = useLevel(module);
  if (level === 'NONE') return <ModuleLock module={module} />;
  return <>{children}</>;
}

export function Stack({ gap = 16, children }: { gap?: number; children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>;
}

export function Split({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 420px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
      <div style={{ flex: '1 1 250px', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {aside}
      </div>
    </div>
  );
}

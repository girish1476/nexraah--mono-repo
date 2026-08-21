'use client';

import { forwardRef, InputHTMLAttributes, ReactNode, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { permissionsAtom, roleAtom, toastAtom } from '@/store/atoms';
import { CITIES } from './geo';
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

/* ---- icons ----------------------------------------------------------------
   One small line-icon per nav module, hand-drawn to a shared 24x24/1.75-stroke
   convention so the sidebar reads as a set. No icon dependency — sixteen
   glyphs isn't worth a package, and this keeps the console usable offline. */

function IconBase({ size = 17, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const MODULE_ICON_PATHS: Record<ModuleKey, ReactNode> = {
  today: (
    <>
      <rect x="4" y="4.5" width="16" height="16" rx="2.5" />
      <path d="M8 3v3M16 3v3M8 12l2.5 2.5L16 9" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  vendors: (
    <>
      <path d="M3 16V7a1 1 0 0 1 1-1h9v10" />
      <path d="M13 10h4l3 3.2V16h-7" />
      <circle cx="7.5" cy="17.5" r="1.8" />
      <circle cx="16.5" cy="17.5" r="1.8" />
    </>
  ),
  compliance: (
    <>
      <path d="M12 3.5 5 6v6c0 4.2 3 7 7 8.5 4-1.5 7-4.3 7-8.5V6l-7-2.5Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  clients: (
    <>
      <path d="M5 20V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v14" />
      <path d="M13 10h5a1 1 0 0 1 1 1v9" />
      <path d="M8 8.5h1M8 12h1M8 15.5h1" />
      <path d="M16 14h1M16 17h1" />
    </>
  ),
  indents: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" />
      <path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h4" />
    </>
  ),
  trips: (
    <>
      <circle cx="6" cy="7" r="2.3" />
      <circle cx="18" cy="17" r="2.3" />
      <path d="M8 8.2c1 1.6 2.6 1.7 4 1.5 3-.4 4.4.6 5 2.6" strokeDasharray="1 3.2" />
    </>
  ),
  pod: (
    <>
      <path d="M6 3.5h9l3 3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M15 3.5V7h3" />
      <path d="M8.5 12.5l2 2 4.5-4.5" />
    </>
  ),
  payments: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M7 14.5h4" />
    </>
  ),
  invoices: (
    <>
      <path d="M7 3.5h7l3.5 3.5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V7h3.5" />
      <path d="M8.5 12h7M8.5 15.5h7" />
    </>
  ),
  receivables: (
    <>
      <path d="M4 12V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6" />
      <path d="M4 12l2.2 6.2a1 1 0 0 0 .94.8h9.72a1 1 0 0 0 .94-.8L20 12" />
      <path d="M4 12h4.2l1 2h5.6l1-2H20" />
    </>
  ),
  rfq: (
    <>
      <path d="M3.5 4.5 20 11l-6.7 2.3L11 20 3.5 4.5Z" />
    </>
  ),
  telematics: (
    <>
      <path d="M12 20.5v-6" />
      <path d="M8.5 17.5a5 5 0 0 1 7 0" />
      <path d="M6 14.5a9 9 0 0 1 12 0" />
      <circle cx="12" cy="20.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  pnl: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M7.5 17v-4M12 17V8M16.5 17v-6.5" />
    </>
  ),
  approvals: (
    <>
      <path d="M4 13V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7" />
      <path d="M4 13l2.2 6.2a1 1 0 0 0 .94.8h9.72a1 1 0 0 0 .94-.8L20 13" />
      <path d="M9.5 12.5 11.3 14.3 15 10.5" />
    </>
  ),
  admin: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 4.5v2M12 17.5v2M19.5 12h-2M6.5 12h-2M17.5 6.5l-1.4 1.4M7.9 16.1l-1.4 1.4M17.5 17.5l-1.4-1.4M7.9 7.9 6.5 6.5" />
    </>
  ),
};

export function ModuleIcon({ module, size = 17 }: { module: ModuleKey; size?: number }) {
  return <IconBase size={size}>{MODULE_ICON_PATHS[module]}</IconBase>;
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
        borderRadius: 'var(--radius-md)',
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
    <div
      style={{
        border: `1px solid ${toneInk(tone)}33`,
        background: `var(--${tone}-tint)`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
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
        backdropFilter: 'blur(2px)',
        animation: 'fade-in var(--transition) both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface"
        style={{
          width: 480,
          maxWidth: '100%',
          padding: '22px 24px',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          animation: 'dialog-in var(--transition) both',
        }}
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
        padding: '12px 18px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-accent-900)',
        color: '#F0F3F8',
        fontSize: 13,
        fontWeight: 500,
        boxShadow: 'var(--shadow-lg)',
        animation: 'toast-in var(--transition) both',
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

/**
 * A city text input with dropdown-style suggestions (`<datalist>`), backed
 * by `lib/geo.ts`. Always still accepts free text — India has far more
 * towns than any fixed list could cover, so this is never a closed
 * `<select>`. `listId` must be unique on the page.
 */
export const CityField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { listId: string }>(
  function CityField({ listId, ...rest }, ref) {
    return (
      <>
        <input {...rest} ref={ref} list={listId} autoComplete="off" />
        <datalist id={listId}>
          {CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </>
    );
  },
);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '22px 2px' }} aria-busy="true">
      <div className="skeleton" style={{ height: 34, width: '38%' }} />
      <div className="skeleton" style={{ height: 84, width: '100%' }} />
      <div className="skeleton" style={{ height: 84, width: '100%' }} />
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {what}…
      </div>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div
      style={{
        border: '1px solid var(--red)',
        background: 'var(--red-tint)',
        borderRadius: 'var(--radius-md)',
        padding: '15px 17px',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: 14 }}>⚠ Could not load this screen</div>
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

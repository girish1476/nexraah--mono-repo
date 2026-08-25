'use client';

import {
  forwardRef,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
} from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { permissionsAtom, roleAtom, toastAtom } from '@/store/atoms';
import { CITIES } from './geo';
import {
  AreaKey,
  Level,
  ModuleKey,
  MODULE_EMOJI,
  MODULE_LABEL,
  Permission,
  ROLE_CODES,
  ROLES,
  RoleCode,
  areaFor,
  levelFor,
} from './permissions';
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

/* ---- the emoji layer ------------------------------------------------------
   Sixteen hand-drawn line icons used to live here, one per module, all drawn
   to a shared 24x24/1.75-stroke convention — and all rendered at 16px in the
   sidebar, where they resolved into a column of small grey shapes nobody
   could tell apart. They are gone.

   An emoji is recognised before it is read: in colour, at any size, with no
   icon package, no training and no offline dependency. That is the entire
   job an icon has in a console used by people who are not power users.

   `aria-hidden` is on every glyph on purpose. A glyph always sits beside the
   word it illustrates, and a screen reader announcing "delivery truck,
   Transporters" is noise, not information. Colour and emoji are decoration
   over words here — never the only thing carrying a meaning. */

export function Glyph({
  children,
  size = 17,
  chip,
  tint,
  className,
}: {
  children: ReactNode;
  size?: number;
  /** Render inside a soft tinted square, so a column of glyphs reads as a set
   *  of buttons rather than a scatter of stickers. */
  chip?: boolean;
  /** The colour of that square — usually one of the `--area-*-tint` tokens. */
  tint?: string;
  /** Extra class, for the few places a glyph needs its own sizing rule. */
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={[chip ? 'glyph glyph-chip' : 'glyph', className].filter(Boolean).join(' ')}
      style={{
        fontSize: size,
        ...(chip ? { ['--chip-tint' as string]: tint ?? 'var(--color-neutral-200)' } : null),
      }}
    >
      {children}
    </span>
  );
}

/** The glyph that stands for a module, wherever one is named. */
export function ModuleIcon({ module, size = 17 }: { module: ModuleKey; size?: number }) {
  return <Glyph size={size}>{MODULE_EMOJI[module]}</Glyph>;
}

/* ---- chrome ------------------------------------------------------------- */

/**
 * "You can see this but not change it" — and, crucially, *who* can.
 *
 * The old copy read "Read-only for BRANCH_MGR": a raw enum, on the most-seen
 * string in the console, that also told the reader nothing they could act on.
 * Naming the desk that owns the screen turns a dead end into a next step —
 * someone to ask. Falls back to the plain sentence when every editing role is
 * ADMIN, since "ask an administrator" is rarely the real answer.
 */
function readOnlyNote(module: ModuleKey): string {
  const owners = ROLE_CODES.filter(
    (r) => r !== 'ADMIN' && levelFor(module, r) === 'EDIT',
  ).map((r) => ROLES[r].label);

  if (owners.length === 0) return 'You can view this, but not change it.';

  const named =
    owners.length === 1
      ? owners[0]
      : `${owners.slice(0, -1).join(', ')} and ${owners[owners.length - 1]}`;
  return `View only — ${named} can make changes here.`;
}

/** The tint and ink of the area a module lives in, as inline CSS values. */
export function areaVars(area: AreaKey): { ink: string; tint: string } {
  return { ink: `var(--area-${area})`, tint: `var(--area-${area}-tint)` };
}

/**
 * The top of every screen: a glyph, the title, and one line of sub-copy.
 *
 * `path` is still accepted so no caller has to change, but it is no longer
 * printed. It rendered the raw route — `/payments/balance` — in monospace as
 * the first thing on every page in the console: a machine detail, in the most
 * prominent position on screen, above the human title it belonged to. It went
 * to the browser's address bar, where it already was.
 *
 * In its place, the module's emoji on a chip tinted to its area, so the page
 * and the sidebar row that reached it are visibly the same colour and the
 * same picture. That is the whole of "where am I", answered without reading.
 */
export function PageHeader({
  path: _path,
  title,
  sub,
  right,
  module,
}: {
  /** @deprecated Not rendered — the address bar already shows the route. */
  path?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
  module?: ModuleKey;
}) {
  const role = useRole();
  const readOnly = module ? levelFor(module, role) === 'VIEW' : false;
  const area = module ? areaFor(module) : 'desk';
  const { tint } = areaVars(area);
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
      <div className="page-head">
        {module && (
          <Glyph chip tint={tint} size={24}>
            {MODULE_EMOJI[module]}
          </Glyph>
        )}
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && (
            <div className="muted" style={{ fontSize: 'var(--text-md)', marginTop: 3 }}>
              {sub}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {readOnly && (
          <span
            /*
             * `data-testid` is the hook the e2e suite asserts on. It used to
             * match the badge's literal text ("Read-only for BRANCH_MGR"),
             * across nineteen assertions in nine spec files — so every time
             * the wording improved, nine suites went red and the copy got
             * reverted rather than the specs updated. What a test should pin
             * here is that the screen rendered view-only for this role, not
             * the sentence it chose to say so.
             */
            data-testid="view-only"
            className="surface muted"
            style={{
              fontSize: 'var(--text-sm)',
              padding: '8px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <Glyph size={14}>👀</Glyph>
            {readOnlyNote(module as ModuleKey)}
          </span>
        )}
        {right}
      </div>
    </div>
  );
}

/**
 * The plain-language answer to "what is this screen for, and who uses it".
 *
 * Sits directly under a `PageHeader`. The console's vocabulary — indent, LR,
 * proof of delivery, advance and balance — is second nature to the people who
 * built it and opaque to the ops, compliance and finance staff who live in it
 * all day. One sentence at the top of a screen is the cheapest place to fix
 * that, so `what` is required and should read like something you would say
 * out loud:
 *
 *   <PageIntro
 *     what="Release the final payment to a transporter once their proof of
 *           delivery has been approved."
 *     who="Finance uses this."
 *   />
 *
 * Styling is deliberately quiet — a hairline rule and body-size text, no card.
 * It must lose to the page title and to the data; it is there to be read once
 * and then ignored forever. `children` takes any extra detail (a caveat, a
 * link) and prints below in the same secondary voice.
 */
export function PageIntro({
  children,
  what,
  who,
}: {
  children?: ReactNode;
  what: string;
  who?: string;
}) {
  return (
    <div className="page-intro">
      <p>{what}</p>
      {who && (
        <div className="page-intro-meta">
          <span className="page-intro-who">{who}</span>
        </div>
      )}
      {children && <div className="page-intro-more">{children}</div>}
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

/**
 * A status word. The tone says how to feel about it; `reason` says why.
 *
 * A colour on its own can only tell someone "this is bad" — never "…because
 * the driving licence expired". Pass `reason` and the because prints beside
 * the pill in plain words, so nobody has to open the record to find out.
 * Omitted, the markup is byte-for-byte what it always was.
 */
/** The emoji a tone carries when a pill or banner does not name its own. */
export const TONE_EMOJI: Record<Tone, string> = {
  mint: '✅',
  blue: '🔵',
  flag: '⚠️',
  red: '⛔',
  grey: '⚪',
};

export function Tag({
  tone = 'grey',
  children,
  reason,
  emoji,
}: {
  tone?: Tone;
  children: ReactNode;
  reason?: string;
  /**
   * A glyph inside the pill. Pass one to say what the status *is* — "🚛 With
   * transporter", "💰 Paid" — which a colour can never do. `true` falls back
   * to the tone's own emoji, which only says how to feel about it.
   */
  emoji?: string | boolean;
}) {
  const mark = emoji === true ? TONE_EMOJI[tone] : typeof emoji === 'string' ? emoji : null;
  const pill = (
    <span className="tag" style={toneVars(tone)}>
      {mark && <Glyph size={12}>{mark}</Glyph>}
      {children}
    </span>
  );
  if (!reason) return pill;
  return (
    <span className="tag-group">
      {pill}
      <span className="tag-reason">{reason}</span>
    </span>
  );
}

export function Banner({
  tone,
  title,
  children,
  right,
  emoji,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  right?: ReactNode;
  /** Defaults to the tone's own glyph; pass a string for something specific. */
  emoji?: string | false;
}) {
  const mark = emoji === false ? null : (emoji ?? TONE_EMOJI[tone]);
  return (
    <div
      style={{
        border: `1px solid ${toneInk(tone)}44`,
        background: `var(--${tone}-tint)`,
        borderRadius: 'var(--radius-md)',
        padding: '15px 17px',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        {mark && <Glyph size={21}>{mark}</Glyph>}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: 'var(--text-lg)',
              color: toneInk(tone),
            }}
          >
            {title}
          </div>
          {children && (
            <div style={{ fontSize: 'var(--text-md)', marginTop: 3, lineHeight: 1.55 }}>{children}</div>
          )}
        </div>
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
  /** The glyph on the tile. Say what the figure *counts*, not how to feel. */
  emoji?: string;
  /**
   * A stable name for the figure, independent of the words on the tile.
   *
   * Renders as `data-testid` and is what the e2e suite locates a tile by.
   * Those specs pin the *arithmetic* — that "money we hold" really is
   * ₹81,920 against the fixtures — and they used to find the tile by its
   * label text, so every clarity pass over the copy broke a dozen value
   * assertions that had nothing to do with the wording. The number is the
   * invariant; the sentence above it is not.
   *
   * Only needed on figures a test asserts on. Kebab-case, and keep it stable
   * even when the label changes — that is the entire point.
   */
  id?: string;
}

/**
 * A row of figures, as tiles.
 *
 * Each carries four things, in this order of loudness: the number, its
 * emoji, its label, and a plain-language note. The old strip carried the
 * first and third only, floating on the page ground — which is how a screen
 * ends up with six numbers on it and no way to tell which one is a problem.
 */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-strip">
      {stats.map((s) => (
        <div
          key={s.k}
          data-testid={s.id}
          style={s.tone ? { ['--tile-edge' as string]: toneInk(s.tone) } : undefined}
        >
          <div className="stat-head">
            {s.emoji && <Glyph size={16}>{s.emoji}</Glyph>}
            <div className="eyebrow">{s.k}</div>
          </div>
          {/*
            Urgency has to survive being colour-blind, or printed, or glanced
            at across a desk. `stat-urgent` adds weight and size on top of the
            ink so a number that needs action is bigger, not merely redder.
            Only red and flag qualify — if every tile shouts, none does.
          */}
          <div
            className={
              s.tone === 'red' || s.tone === 'flag' ? 'stat-value stat-urgent' : 'stat-value'
            }
            style={{ color: s.tone ? toneInk(s.tone) : 'var(--color-text)' }}
          >
            {s.v}
          </div>
          {s.note && (
            <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 3, lineHeight: 1.45 }}>
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
  /**
   * A quiet second line printed under `render`. Use it to fold the two or
   * three columns nobody scans independently — route, reference code, branch —
   * into the one cell people actually look at:
   *
   *   { key: 'client', label: 'Client', primary: true,
   *     render: (r) => r.clientName,
   *     sub: (r) => `${r.from} → ${r.to} · ${r.indentNo}` }
   *
   * Returning null or undefined for a row just omits the line.
   */
  sub?: (row: T) => ReactNode;
  /**
   * Marks this column as the row's identity: `render` prints at 15.5px/600 in
   * full-strength ink while every other cell stays at body weight, so the eye
   * lands on the name of the thing rather than on whichever machine code
   * happens to sit in column one. On a phone this cell becomes the card's
   * title instead of another labelled key/value line.
   *
   * One per table. Two competing headlines is the wall of uniform text again.
   */
  primary?: boolean;
}

/**
 * A cell's content, in one line or two.
 *
 * Columns that set neither `primary` nor `sub` return exactly what `render`
 * gave — no wrapper, no class — so every table that existed before this
 * feature renders byte-for-byte as it did.
 */
function cellBody<T>(column: Column<T>, row: T): ReactNode {
  const main = column.render(row);
  if (!column.primary && !column.sub) return main;
  const sub = column.sub?.(row);
  return (
    <span className={column.primary ? 'cell-stack cell-stack-primary' : 'cell-stack'}>
      <span className="cell-lead">{main}</span>
      {sub !== null && sub !== undefined && sub !== false && sub !== '' && (
        <span className="cell-sub">{sub}</span>
      )}
    </span>
  );
}

/**
 * An empty list that teaches instead of one that shrugs.
 *
 * "No data" tells someone nothing except that they may be lost. `title` names
 * what would be sitting here, `hint` says how to make the first one appear,
 * and `action` optionally carries the button that does it:
 *
 *   <EmptyState
 *     title="No payments are waiting for your approval"
 *     hint="A payment lands here once the transporter's delivery paperwork
 *           has been checked and approved."
 *   />
 *
 * Pass one to `DataTable`'s `empty` prop, or use it standalone inside a
 * `Panel`. Keep `hint` to the next step someone can actually take — an empty
 * queue is very often good news, and should not read like a fault.
 */
export function EmptyState({
  title,
  hint,
  action,
  emoji = '📭',
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  /**
   * The face of the empty space. Default is an empty tray; pass something
   * cheerful (`'🎉'`, `'✅'`) when the queue being empty is a good day's work
   * rather than a missing record.
   */
  emoji?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">
        {emoji}
      </span>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-body">{hint}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
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
  /**
   * What to show when `rows` is empty. A plain string keeps the original
   * one-line muted note; pass an `<EmptyState/>` (or any node) instead to
   * explain what belongs here and how to create the first one.
   */
  empty?: ReactNode;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    // A string keeps the wrapper it has always had. A node brings its own
    // padding and alignment, so wrapping it would double both.
    if (typeof empty === 'string') {
      return (
        <div className="muted" style={{ padding: '28px 14px', textAlign: 'center', fontSize: 12.5 }}>
          {empty}
        </div>
      );
    }
    return <>{empty}</>;
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
                  className={
                    [c.align === 'right' || c.mono ? 'num' : '', c.primary ? 'cell-primary' : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  {cellBody(c, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- the journey ---------------------------------------------------------
   One shipment, ten steps, in the order they actually happen — and one emoji
   each, so the sequence can be read as a picture instead of parsed as a word.

   This is the spine of the whole console, and the single most important
   thing in the redesign. Everyone in this business already thinks in these
   ten steps. The software made them read a status ("POD_UPLOADED") and
   translate it back into a position in that sequence themselves, on every
   row, all day. Ten glyphs on a rail say "that is behind you, you are here,
   this is what is left" before a single word is read.

   `label` is the plain-language name — what someone would say out loud.
   `term` is the trade word for the same step, kept because these people do
   use it with each other and with clients; it prints as the sub-line on the
   detail rail and as the tooltip everywhere else, which is how the console
   teaches its own vocabulary instead of assuming it.

   Fixed vocabulary. An eleventh step is a business decision, not a UI one. */

export interface JourneyStep {
  label: string;
  emoji: string;
  /** The trade word for the same step, glossed rather than assumed. */
  term?: string;
}

export const JOURNEY_STEPS: JourneyStep[] = [
  { label: 'Load requested', emoji: '📝', term: 'Indent created' },
  { label: 'Vehicle booked', emoji: '🚚', term: 'Trip generated' },
  { label: 'Lorry receipt issued', emoji: '🧾', term: 'LR issued' },
  { label: 'Advance papers in', emoji: '📄', term: 'Advance documents uploaded' },
  { label: 'Advance paid', emoji: '⏩', term: 'Advance released to transporter' },
  { label: 'On the road', emoji: '📍', term: 'In transit / tracking' },
  { label: 'Unloaded', emoji: '📦', term: 'Delivered at destination' },
  { label: 'Delivery proof in', emoji: '📸', term: 'POD uploaded' },
  { label: 'Proof checked', emoji: '🔍', term: 'POD verified' },
  { label: 'Final payment out', emoji: '🏁', term: 'Balance released' },
];

/** The ten step names alone, for anything that only needs the words. */
export const LIFECYCLE_STEPS = JOURNEY_STEPS.map((s) => s.label);

/**
 * The ten steps, spelled out, for the head of a detail page.
 *
 *   ✓——✓——✓——[📄]——⏩——📍——📦——📸——🔍——🏁
 *   Load    Vehicle  Lorry   Advance
 *   requested booked receipt papers in
 *                            NOW
 *
 * `step` counts the steps that are *finished*, so the one after it is what
 * happens next. Pass `stuck` when that next step cannot start and it turns
 * red — the reader gets the shape of the problem (three done, seven to go,
 * jammed on the fourth) before reading a word. What would clear it belongs
 * in a `BlockedPanel` underneath; this rail only points at it.
 *
 * Finished steps drop their emoji for a flat mint tick. Ten coloured glyphs
 * in a row is a fruit salad, and all a finished step needs to say is
 * "finished".
 *
 * The rail scrolls inside itself, never taking the page sideways with it.
 */
export function Journey({
  step,
  stuck,
  steps = JOURNEY_STEPS,
}: {
  step: number;
  stuck?: boolean;
  steps?: JourneyStep[];
}) {
  const count = steps.length;
  const done = Math.max(0, Math.min(Math.floor(step) || 0, count));
  const nowIndex = done - 1;
  const nextIndex = done;

  return (
    <ol
      className="journey"
      aria-label={
        stuck
          ? `Progress: ${done} of ${count} steps done, held at ${steps[nextIndex]?.label ?? 'the next step'}`
          : `Progress: ${done} of ${count} steps done — ${steps[nowIndex]?.label ?? 'not started'}`
      }
    >
      {steps.map((s, i) => {
        const isStuck = Boolean(stuck) && i === nextIndex;
        const isNow = !stuck && i === nowIndex;
        const isDone = stuck ? i < done : i < nowIndex;
        const state = isStuck ? 'is-stuck' : isNow ? 'is-now' : isDone ? 'is-done' : 'is-todo';
        return (
          <li
            key={s.label}
            className={`journey-step ${state}`}
            aria-current={isNow ? 'step' : undefined}
            title={s.term ? `${s.label} — also called "${s.term}"` : s.label}
          >
            <span className="journey-node">
              <span aria-hidden="true">{isDone ? '✓' : s.emoji}</span>
            </span>
            <span className="journey-name">{s.label}</span>
            {(isNow || isStuck) && (
              <span className="journey-state">{isStuck ? 'Stuck here' : 'You are here'}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The same journey, small enough to live in a table cell.
 *
 *   ●●●●●●●○○○  📸 Delivery proof in · 7 of 10
 *
 * The pips are decoration; the emoji, the step name and the count beside
 * them are the real text — so this reads correctly to a screen reader,
 * survives a monochrome print, and still works for someone who cannot tell
 * blue from red.
 */
export function JourneyMini({
  step,
  tone = 'blue',
  steps = JOURNEY_STEPS,
  label,
}: {
  step: number;
  tone?: Tone;
  steps?: JourneyStep[];
  /** Overrides the step name — use it to say "Placement failed" on an
   *  exception branch that is not one of the ten. */
  label?: string;
}) {
  const count = steps.length;
  const done = Math.max(0, Math.min(Math.floor(step) || 0, count));
  const current = steps[done - 1];
  return (
    <span className="journey-sm" style={{ ['--journey-ink' as string]: toneInk(tone) }}>
      <span className="journey-sm-track" aria-hidden="true">
        {steps.map((s, i) => (
          <span
            key={s.label}
            className={i < done ? (i === done - 1 ? 'is-done is-now' : 'is-done') : undefined}
          />
        ))}
      </span>
      <span className="journey-sm-label">
        {current && <Glyph size={14}>{current.emoji}</Glyph>}
        {label ?? current?.label ?? 'Not started'}
      </span>
      <span className="journey-sm-count">
        {done} of {count}
      </span>
    </span>
  );
}

/**
 * Phase tabs with counts, for the top of a list.
 *
 *   Needs you 7 | Moving 24 | Waiting on vendor 3 | Blocked 2 | Done 118
 *
 * A dozen granular statuses is a vocabulary test; four or five phases is a
 * question someone can answer — "which of these is my problem right now?".
 * Collapse the statuses into phases here and let the table stay narrow.
 *
 * `count` prints inline so the size of each pile is visible before anyone
 * clicks, and `tone` colours that count — a red 2 on "Blocked" is legible
 * even while the tab is unselected, which is exactly when it matters.
 *
 * Real buttons, so tab and Enter work; left/right arrows move between them.
 */
export function StageTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number; tone?: Tone }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const move = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0 || tabs.length === 0) return;
    event.preventDefault();
    const next = (index + delta + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    const siblings = event.currentTarget.parentElement?.querySelectorAll('button');
    siblings?.[next]?.focus();
  };

  return (
    <div className="stage-tabs" role="tablist">
      {tabs.map((tab, index) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={active ? 'stage-tab is-active' : 'stage-tab'}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="stage-tab-label">{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className="stage-tab-count"
                style={tab.tone ? toneVars(tab.tone) : undefined}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Search and filters on one line, above the data.
 *
 *   <Toolbar search={<input placeholder="Search client, LR or vehicle" />}>
 *     <select …>…</select>
 *     <select …>…</select>
 *   </Toolbar>
 *
 * The thing this replaces is a bordered panel of stacked labelled fields
 * sitting between someone and the list they came to read — a box that costs a
 * third of the first screen and is used once a week. Filters are a control,
 * not content: one quiet line, search first because it is what people reach
 * for, everything else trailing after it.
 */
export function Toolbar({ children, search }: { children?: ReactNode; search?: ReactNode }) {
  return (
    <div className="toolbar">
      {search && <div className="toolbar-search">{search}</div>}
      {children && <div className="toolbar-controls">{children}</div>}
    </div>
  );
}

/* One glyph per tone, so the marker never carries a meaning the tone does not
   already have. The lock is deliberately the same one `BlockedPanel` uses —
   seeing 🔒 in a list and 🔒 on the panel that explains it should feel like
   the same fact stated twice, not like two different systems. */
const NEXT_ACTION_MARK: Record<Tone, string> = {
  flag: '⚑',
  red: '🔒',
  blue: '→',
  mint: '✓',
  grey: '·',
};

/**
 * What to do about this row, whose job it is, and how long it has been sat
 * there — the three things a status pill in the last column never says.
 *
 *   ⚑ Verify POD
 *     Compliance · 4d
 *
 * `action` is an instruction in plain words: a verb the reader can act on
 * ("Verify POD", "Release balance", "Chase advance receipt"), never a state
 * ("PENDING_VERIFICATION"). `owner` is the desk that owns it, so anyone can
 * tell in one glance whether the row is theirs. `age` is how long it has been
 * waiting — the number that turns a list into a queue.
 *
 * `tone` stays inside the five: flag for needs-your-action, red for blocked,
 * blue while it is moving or waiting on someone else, mint once settled, grey
 * when nothing is expected. Where a row is blocked, the words explaining what
 * would clear it belong in a `BlockedPanel` on the record itself — this is
 * the pointer, not the explanation.
 */
export function NextAction({
  action,
  owner,
  age,
  tone = 'flag',
  mark,
}: {
  action: ReactNode;
  owner?: string;
  age?: string;
  tone?: Tone;
  mark?: ReactNode;
}) {
  const meta = [owner, age].filter(Boolean).join(' · ');
  return (
    <span className="next-action">
      <span className="next-action-mark" style={{ color: toneInk(tone) }} aria-hidden="true">
        {mark ?? NEXT_ACTION_MARK[tone]}
      </span>
      <span className="next-action-body">
        <span className="next-action-label">{action}</span>
        {meta && <span className="next-action-meta">{meta}</span>}
      </span>
    </span>
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

/**
 * Direct URL to a module the role lacks — a lock panel naming the owner.
 *
 * The owners used to print as raw role codes: "It belongs to COMPLIANCE,
 * ADMIN." A screaming enum is not a person somebody can go and ask, and it
 * is exactly the kind of internal identifier this console should never put
 * in front of a reader. They print as desk names now.
 */
export function ModuleLock({ module }: { module: ModuleKey }) {
  const role = useRole();
  const owners = (Object.keys(ROLES) as RoleCode[])
    .filter((r) => levelFor(module, r) === 'EDIT')
    .map((r) => ROLES[r].label);
  const named =
    owners.length <= 1
      ? owners[0]
      : `${owners.slice(0, -1).join(', ')} and ${owners[owners.length - 1]}`;
  return (
    <div className="surface" style={{ padding: 24, maxWidth: 560 }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Glyph size={24}>🔒</Glyph>
        {MODULE_LABEL[module]}
      </h1>
      <p style={{ fontSize: 'var(--text-base)', marginTop: 10, lineHeight: 1.6 }}>
        {MODULE_LABEL[module]} is not part of the {ROLES[role].label} console.
        {owners.length > 0 && ` It belongs to ${named} — ask them if you need something from it.`}
      </p>
      <p className="hint">
        This is not just a hidden button: the server refuses the underlying requests too. The panel
        is how that rule is shown, not the rule itself.
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

/* ---- the work-first primitives -------------------------------------------
   A table answers "what exists". Nobody arriving at work has that question.
   The three components below answer "what should I do", "am I done" and
   "where do I go" — which is what the console was missing, and most of what
   "not user friendly" actually meant. */

/**
 * One pile of work, stated as a job rather than a metric.
 *
 *   🚛  3 loads still have no transporter
 *       Nobody has quoted these yet, and the earliest pickup is Thursday.
 *       [ Find transporters ]
 *
 * `count` is the number being triaged on, `title` names the pile in words a
 * person would use out loud, and `why` says what happens if it is left —
 * because "3 pending" has never once told anybody whether to care. `action`
 * carries the button that starts the work; a card without one is a card
 * telling somebody about a problem they cannot fix, which is worth checking
 * before you ship it.
 */
export function ActionCard({
  emoji,
  tone = 'flag',
  count,
  title,
  why,
  action,
}: {
  emoji: string;
  tone?: Tone;
  count?: ReactNode;
  title: string;
  why?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="action-card"
      style={{
        ['--card-ink' as string]: toneInk(tone),
        ['--card-tint' as string]: `var(--${tone}-tint)`,
      }}
    >
      <Glyph chip tint={`var(--${tone}-tint)`} className="action-card-chip" size={22}>
        {emoji}
      </Glyph>
      <div className="action-card-body">
        <div className="action-card-title">
          {count !== undefined && count !== null && (
            <span className="action-card-count">{count}</span>
          )}
          {title}
        </div>
        {why && <div className="action-card-why">{why}</div>}
        {action && <div className="action-card-do">{action}</div>}
      </div>
    </div>
  );
}

/**
 * The other half of a queue's life. An empty queue that renders as nothing
 * reads as a broken screen; an empty queue that says so reads as a good day.
 */
export function AllClear({ children, emoji = '✅' }: { children: ReactNode; emoji?: string }) {
  return (
    <div className="all-clear">
      <Glyph size={20}>{emoji}</Glyph>
      <span>{children}</span>
    </div>
  );
}

/** A named break between groups of panels, so a long screen reads as parts. */
export function SectionHead({
  emoji,
  title,
  note,
  right,
}: {
  emoji: string;
  title: string;
  note?: string;
  right?: ReactNode;
}) {
  return (
    <div className="section-head">
      <Glyph size={20}>{emoji}</Glyph>
      <h2>{title}</h2>
      {note && <span className="section-head-note">{note}</span>}
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

/**
 * Fat, hue-coded shortcuts to the screens a role actually opens.
 *
 * The sidebar is not the only place a person should be able to find things,
 * and on a phone it is behind a hamburger. These are built from the same
 * `NAV` the sidebar is, filtered the same way, so they can never drift out
 * of step with what the signed-in role is allowed to see.
 */
export function QuickLinks({ items }: { items: { href: string; emoji: string; label: string; note?: string; area: AreaKey }[] }) {
  return (
    <div className="quick-grid">
      {items.map((item) => {
        const { ink, tint } = areaVars(item.area);
        return (
          <a
            key={item.href}
            href={item.href}
            className="quick-card"
            style={{ ['--quick-ink' as string]: ink }}
          >
            <Glyph chip tint={tint} size={18}>
              {item.emoji}
            </Glyph>
            <span style={{ minWidth: 0 }}>
              <span className="quick-card-title">{item.label}</span>
              {item.note && <span className="quick-card-note">{item.note}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
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

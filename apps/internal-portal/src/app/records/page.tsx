'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime } from '@/lib/format';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  SectionHead,
  Stack,
  StatStrip,
  Tag,
  useToast,
} from '@/lib/ui';
import { auditFilterOptions, listAuditEvents } from './apis';
import { AuditEvent, AuditFilterOptions, AuditPage } from './types';

const PAGE_SIZE = 50;

/** Renders a stored value for a human — not `[object Object]`, not `undefined`. */
function readable(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(blank)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** `advance_pct` → `advance pct`. Column names are not words. */
function fieldName(field: string): string {
  return field.replace(/_/g, ' ');
}

/**
 * `/records` — the record of what everyone did.
 *
 * Every change in this system has been written down since the day it was
 * built, and until now there was no way to read it. "Transactions check" and
 * "legitimacy of operations" — both named as Finance's job — meant opening the
 * database. This is that work, in the app.
 *
 * Nothing on this screen changes anything, and nothing on it can: the table
 * refuses edits and deletions at the database itself, for everybody, including
 * whoever is reading it. That is what makes it worth reading.
 */
export default function RecordsPage() {
  const toast = useToast();

  const [page, setPage] = useState<AuditPage | null>(null);
  const [options, setOptions] = useState<AuditFilterOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditEvent | null>(null);

  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const load = () => {
    setError(null);
    listAuditEvents({
      action: action || undefined,
      entityType: entityType || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then(setPage)
      .catch((e) => setError(errorMessage(e)));
  };

  useEffect(load, [action, entityType, from, to, offset]);
  useEffect(() => {
    auditFilterOptions()
      .then(setOptions)
      .catch((e) => toast(errorMessage(e)));
  }, []);

  /** Any filter change starts again from the first page — otherwise page 3 of a new filter is blank. */
  const changeFilter = (set: (v: string) => void) => (value: string) => {
    setOffset(0);
    set(value);
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!page) return <Loading what="Loading the record" />;

  const byVendor = page.events.filter((e) => e.byVendor).length;
  const people = new Set(page.events.map((e) => e.actorName ?? e.actorRole)).size;

  const columns: Column<AuditEvent>[] = [
    {
      key: 'what',
      label: 'What happened',
      primary: true,
      render: (e) => e.summary,
      sub: (e) => (e.entityId ? `${e.entityLabel} · ${e.entityId}` : e.entityLabel),
    },
    {
      key: 'who',
      label: 'Who',
      render: (e) => e.actorName ?? '—',
      sub: (e) => (e.byVendor ? 'through the transporter portal' : e.actorRole),
    },
    {
      key: 'changed',
      label: 'What changed',
      render: (e) =>
        e.changed.length === 0 ? (
          <span className="hint">—</span>
        ) : (
          <Tag tone="blue" emoji="✏️">
            {e.changed.length} field{e.changed.length === 1 ? '' : 's'}
          </Tag>
        ),
    },
    { key: 'when', label: 'When', render: (e) => fmtDateTime(e.at) },
    {
      key: 'go',
      label: '',
      render: (e) => (
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(e)}>
          See detail
        </button>
      ),
    },
  ];

  return (
    <ModuleGuard module="records">
      <PageHeader
        title="Activity log"
        sub="Every change anyone made, who made it, and when"
        module="records"
      />
      <PageIntro
        what="The full trail, newest first. Narrow it by what was done, what it was done to, or when."
        who="Finance checks transactions against it, Leadership oversees with it, and Administration keeps it. Nobody can change it — not even them."
      >
        Nothing on this screen edits anything. The record refuses to be altered or deleted at the
        database itself, so what it says today is what it will say in a year — which is the only
        reason it settles an argument.
      </PageIntro>

      <StatStrip
        stats={[
          {
            k: 'Entries found',
            v: page.total,
            emoji: '🧭',
            id: 'records-total',
            note: 'Matching what you have asked for',
          },
          {
            k: 'People on this page',
            v: people,
            emoji: '👤',
            id: 'records-people',
            note: 'Distinct people who did something',
          },
          {
            k: 'Done by transporters',
            v: byVendor,
            emoji: '🚛',
            id: 'records-vendor',
            note: 'Through their own portal, not one of our desks',
          },
        ]}
      />

      <SectionHead emoji="🔍" title="Narrow it down" note="Leave a filter empty to include everything" />

      <Panel>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <Field label="What was done">
            <select value={action} onChange={(e) => changeFilter(setAction)(e.target.value)}>
              <option value="">Anything</option>
              {(options?.actions ?? []).map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What it was done to">
            <select value={entityType} onChange={(e) => changeFilter(setEntityType)(e.target.value)}>
              <option value="">Anything</option>
              {(options?.entityTypes ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" value={from} onChange={(e) => changeFilter(setFrom)(e.target.value)} />
          </Field>
          <Field label="Up to and including">
            <input type="date" value={to} onChange={(e) => changeFilter(setTo)(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel pad={false}>
        <DataTable
          columns={columns}
          rows={page.events}
          rowKey={(e) => e.id}
          onRowClick={(e) => setOpen(e)}
          empty={
            <EmptyState
              emoji="🧭"
              title="Nothing matches what you have asked for"
              hint="Widen the dates, or set the two dropdowns back to “Anything”."
            />
          }
        />
      </Panel>

      {page.total > PAGE_SIZE && (
        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}
        >
          <button
            className="btn btn-secondary btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            ← Newer
          </button>
          <span className="hint">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} of {page.total}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={offset + PAGE_SIZE >= page.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Older →
          </button>
        </div>
      )}

      {/* ---- one entry ---------------------------------------------------- */}
      <Dialog
        open={Boolean(open)}
        title={open ? open.summary : ''}
        confirmLabel="Close"
        onConfirm={() => setOpen(null)}
        onClose={() => setOpen(null)}
      >
        {open && (
          <Stack gap={14}>
            <div className="hint">
              {fmtDateTime(open.at)} · {open.actorName ?? 'Unknown person'} ({open.actorRole})
              {open.byVendor ? ' · through the transporter portal' : ''}
            </div>

            {open.entityId && (
              <div className="hint">
                {open.entityLabel} · <code>{open.entityId}</code>
              </div>
            )}

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                What changed
              </div>
              {open.changed.length === 0 ? (
                <div className="hint">
                  Nothing was recorded as changing — this entry marks the action itself.
                </div>
              ) : (
                <Stack gap={8}>
                  {open.changed.map((c) => (
                    <div
                      key={c.field}
                      className="surface"
                      style={{ padding: '10px 12px', display: 'flex', gap: 10, flexWrap: 'wrap' }}
                    >
                      <span style={{ fontWeight: 600, minWidth: 140 }}>{fieldName(c.field)}</span>
                      <span className="hint" style={{ flex: 1 }}>
                        {readable(c.from)} → <strong>{readable(c.to)}</strong>
                      </span>
                    </div>
                  ))}
                </Stack>
              )}
            </div>

            <div className="hint">
              🔒 This entry cannot be edited or removed by anyone, including an administrator.
            </div>
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}

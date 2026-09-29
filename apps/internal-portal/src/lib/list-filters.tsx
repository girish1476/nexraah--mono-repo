'use client';

import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/apis';
import { Field } from '@/lib/ui';

/**
 * Multi-field search for the order lists.
 *
 * The owner's note for the All Orders page asked for a search on each of the
 * things staff actually remember a load by — stage, transporter, client, the
 * two cities, the truck, the load-request or trip number, the branch — plus a
 * way to export what they found. Every list of orders needs the same thing, so
 * it lives here once and each page only says which fields it has.
 *
 * Fields are all optional and all combine (every filled field must match).
 * Text fields wait for a short pause in typing before they apply, so a page
 * that asks the server does not fire a request per keystroke.
 */

export type FilterField =
  | { kind: 'text'; key: string; label: string; placeholder?: string; hint?: string }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: { value: string; label: string }[];
      /** Wording for the "no filter" choice. Defaults to "Any". */
      allLabel?: string;
    };

export type FilterValues = Record<string, string>;

export function emptyFilters(fields: FilterField[]): FilterValues {
  return Object.fromEntries(fields.map((f) => [f.key, '']));
}

/** How many fields currently narrow the list. */
export function activeFilterCount(values: FilterValues): number {
  return Object.values(values).filter((v) => v.trim() !== '').length;
}

/**
 * Lower-cased with spaces and dashes removed, so "MH 12 AB 1234", "mh-12-ab-1234"
 * and "MH12AB1234" are all the same truck, and "Sai Kripa" finds "sai-kripa".
 */
export function squash(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[\s-]+/g, '');
}

/**
 * For pages that filter rows they already hold: true when `needle` is empty, or
 * appears in any of the given fields. Missing fields never match.
 */
export function matchesAny(needle: string, ...haystacks: (string | number | null | undefined)[]): boolean {
  const wanted = squash(needle);
  if (!wanted) return true;
  return haystacks.some((h) => squash(h === null || h === undefined ? '' : String(h)).includes(wanted));
}

const TYPING_PAUSE_MS = 300;

function TextFilter({
  field,
  value,
  onCommit,
}: {
  field: Extract<FilterField, { kind: 'text' }>;
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Always call the latest `onCommit`: the parent rebuilds it every render, and
  // a stale one would write an old copy of the other fields back over newer ones.
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (next: string) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit.current(next), TYPING_PAUSE_MS);
  };
  const applyNow = () => {
    clearTimeout(timer.current);
    commit.current(draft);
  };

  return (
    <Field label={field.label} hint={field.hint}>
      <input
        value={draft}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && applyNow()}
        onBlur={applyNow}
        placeholder={field.placeholder}
        autoComplete="off"
        data-filter={field.key}
      />
    </Field>
  );
}

export function FilterBar({
  fields,
  values,
  onChange,
  onExport,
  resultNote,
}: {
  fields: FilterField[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  /** Builds and downloads the file. Omit to hide the export button. */
  onExport?: () => Promise<void>;
  /** Right of the buttons — "12 of 340 orders", or whatever tells people what they are looking at. */
  resultNote?: string;
}) {
  // Bumped on Clear so the text boxes, which hold their own half-typed draft,
  // start over instead of showing words the list is no longer filtered by.
  const [generation, setGeneration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const active = activeFilterCount(values);

  // A blur commits whatever is typed, changed or not; ignoring a no-op here
  // keeps that from refetching the list every time someone tabs through.
  const set = (key: string, next: string) => {
    if ((values[key] ?? '') === next) return;
    onChange({ ...values, [key]: next });
  };

  const exportNow = async () => {
    if (!onExport || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExport();
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="filter-bar" aria-label="Search and filters">
      <div className="filter-grid" key={generation}>
        {fields.map((field) =>
          field.kind === 'text' ? (
            <TextFilter key={field.key} field={field} value={values[field.key] ?? ''} onCommit={(v) => set(field.key, v)} />
          ) : (
            <Field key={field.key} label={field.label}>
              <select
                value={values[field.key] ?? ''}
                onChange={(e) => set(field.key, e.target.value)}
                data-filter={field.key}
              >
                <option value="">{field.allLabel ?? 'Any'}</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          ),
        )}
      </div>
      <div className="filter-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={active === 0}
          onClick={() => {
            setGeneration((g) => g + 1);
            onChange(emptyFilters(fields));
          }}
        >
          Clear{active > 0 ? ` ${active} filter${active === 1 ? '' : 's'}` : ' filters'}
        </button>
        {onExport && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={exporting} onClick={exportNow}>
            {exporting ? 'Preparing file…' : '⬇ Export to spreadsheet'}
          </button>
        )}
        {resultNote && <span className="filter-note">{resultNote}</span>}
      </div>
      {exportError && (
        <div className="err" role="alert" style={{ marginTop: 8 }}>
          Could not export: {exportError}
        </div>
      )}
    </section>
  );
}

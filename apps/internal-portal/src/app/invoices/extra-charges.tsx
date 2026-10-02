'use client';

import { Field } from '@/lib/ui';
import { ExtraCharge } from './types';

/** One "+ Add charge" row as the form holds it — rupees, like the fixed heads. */
export interface ExtraChargeRow {
  label: string;
  rupees: number;
}

export const toExtraChargeRows = (charges: ExtraCharge[] | undefined): ExtraChargeRow[] =>
  (charges ?? []).map((c) => ({ label: c.label, rupees: c.amountPaise / 100 }));

/** A row left completely blank is ignored rather than sent. */
export const toExtraCharges = (rows: ExtraChargeRow[]): ExtraCharge[] =>
  rows
    .filter((r) => r.label.trim() || r.rupees)
    .map((r) => ({ label: r.label.trim(), amountPaise: Math.round(r.rupees * 100) }));

export const extraChargesPaise = (rows: ExtraChargeRow[]) =>
  toExtraCharges(rows).reduce((sum, c) => sum + c.amountPaise, 0);

/** An amount with no name can't be printed on the invoice. */
export const hasUnnamedExtraCharge = (rows: ExtraChargeRow[]) => rows.some((r) => r.rupees && !r.label.trim());

/**
 * The named charge lines under the fixed heads — anything the client is
 * billed for that loading, unloading, detention and other don't name.
 */
export function ExtraChargeFields({
  rows,
  onChange,
}: {
  rows: ExtraChargeRow[];
  onChange: (rows: ExtraChargeRow[]) => void;
}) {
  const patch = (index: number, change: Partial<ExtraChargeRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));

  return (
    <div style={{ display: 'grid', gap: 13, marginTop: 13 }}>
      {rows.map((row, index) => (
        <div
          key={index}
          style={{ display: 'grid', gap: 13, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto', alignItems: 'end' }}
        >
          <Field label="Charge name">
            <input
              value={row.label}
              maxLength={60}
              placeholder="e.g. Toll, Weighment"
              onChange={(e) => patch(index, { label: e.target.value })}
            />
          </Field>
          <Field label="Amount (₹)">
            <input
              type="number"
              min={0}
              value={row.rupees || ''}
              onChange={(e) => patch(index, { rupees: Math.max(0, Number(e.target.value)) })}
            />
          </Field>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`Remove ${row.label.trim() || 'charge'}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange([...rows, { label: '', rupees: 0 }])}
        >
          + Add charge
        </button>
      </div>
    </div>
  );
}

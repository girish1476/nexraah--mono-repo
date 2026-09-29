/**
 * Download a table as a spreadsheet file.
 *
 * CSV rather than .xlsx: Excel, Google Sheets and Numbers all open it, and it
 * needs no library. Two details matter more than they look:
 *
 * - A leading byte-order mark, or Excel reads the file as ANSI and turns the
 *   rupee sign and the arrows in lanes into mojibake.
 * - Cells that begin with `=`, `+`, `-` or `@` are prefixed with an apostrophe.
 *   A client name or a remark is typed by a person, and a spreadsheet will
 *   otherwise run it as a formula the moment someone opens the export.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : value;
  // A number is safe as it is — including a negative one. Only text is at risk.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Today as `2026-09-26`, for file names — local time, which is the day the user means. */
export function todayStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const blob = new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

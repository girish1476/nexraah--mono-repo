/**
 * A CSV reader, because the three go-live files are CSV and pulling in a
 * dependency for ~60 lines of well-specified parsing is not worth the supply
 * chain.
 *
 * Handles the parts that actually bite on real spreadsheet exports: quoted
 * fields, embedded commas and newlines inside quotes, `""` as an escaped
 * quote, CRLF line endings, and a UTF-8 BOM that Excel adds and nothing else
 * mentions. It is deliberately not a general CSV library — no custom
 * delimiters, no comment syntax, no type coercion.
 */

export interface CsvTable {
  header: string[];
  /** One entry per data row: header name -> cell value, trimmed. */
  rows: Record<string, string>[];
}

/** Split raw CSV text into a rectangular grid of cells. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Excel's BOM

  const grid: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    grid.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && cell === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endCell();
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endRow();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  // A file that does not end in a newline still has a final row.
  if (cell !== '' || row.length > 0) endRow();

  // Drop trailing blank lines, which every editor adds and no import wants.
  while (grid.length > 0 && grid[grid.length - 1].every((c) => c.trim() === '')) grid.pop();

  return grid;
}

/**
 * Parse into header-keyed rows. Header names are lower-cased and
 * underscore-normalised so `Legal Name`, `legal_name` and `LEGAL NAME` are the
 * same column — go-live files are produced by hand and this is the single
 * most common reason an otherwise valid file fails.
 */
export function readTable(text: string): CsvTable {
  const grid = parseCsv(text);
  if (grid.length === 0) return { header: [], rows: [] };

  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const rows = grid.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((name, idx) => {
      row[name] = (cells[idx] ?? '').trim();
    });
    return row;
  });

  return { header, rows };
}

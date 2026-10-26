import type { ReadField, Reading } from './attachments';
import { gstinCheckDigit } from './gstin';

/**
 * "Fetch" without a server reader: the number is read off the picture here, in
 * the browser, by Tesseract. It costs nothing, needs no key, and the picture
 * never leaves this computer — which is also why it is allowed to read a PAN or
 * an Aadhaar card without the switch the server reader needs.
 *
 * It is a plainer reader than the server's. It cannot be told what a paper is
 * or where on it to look; it turns a picture into text and nothing more. So it
 * only fills the boxes whose number proves itself — a PAN's fixed pattern, the
 * check digit an Aadhaar number or a GSTIN ends in — and everything it reads is
 * held to that proof. The module's standing rule is the server's: a blank is
 * better than a guess.
 *
 * A card photographed sideways or upside down reads as noise the right way up,
 * so the picture is tried at each quarter turn until the number is found.
 */

type Format = NonNullable<ReadField['format']>;

/** The kinds of number that can be told from text alone, with nobody saying where on the page they are. */
const READABLE: readonly Format[] = ['pan', 'aadhaarLast4', 'gstin', 'ifsc', 'udyam'];

/** Characters a photograph makes look alike, each way round. */
const AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };
const AS_DIGIT: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };

/** Each line of the text in capitals with everything but letters and digits taken out — a spaced-out number closes up. */
const closedLines = (text: string) =>
  text
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9]/g, ''));

/** Every run of `length` characters in the text's lines that `take` accepts. */
function windows(text: string, length: number, take: (run: string) => string | null): Set<string> {
  const found = new Set<string>();
  for (const line of closedLines(text)) {
    for (let i = 0; i + length <= line.length; i++) {
      const value = take(line.slice(i, i + length));
      if (value) found.add(value);
    }
  }
  return found;
}

/** One answer or none: two different numbers that both pass means it cannot be said which was asked for. */
const only = (found: Set<string>) => (found.size === 1 ? [...found][0] : null);

/* ------------------------------------------------------------------ PAN -- */

/** The fourth letter says who holds the PAN: a person, a company, a firm, a trust… */
const PAN_HOLDER = 'PCHFATBLJG';

function pan(text: string): string | null {
  return only(
    windows(text, 10, (run) => {
      // Look-alikes are put right, but only around digits that were read as digits — a word is not a PAN.
      if (run.slice(5, 9).replace(/\D/g, '').length < 3) return null;
      let value = '';
      for (let i = 0; i < 10; i++) value += (i >= 5 && i <= 8 ? AS_DIGIT : AS_LETTER)[run[i]] ?? run[i];
      return /^[A-Z]{5}\d{4}[A-Z]$/.test(value) && PAN_HOLDER.includes(value[3]) ? value : null;
    }),
  );
}

/* -------------------------------------------------------------- Aadhaar -- */

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** The Verhoeff check an Aadhaar number ends in. Mirrors internal-api's `ocr.formats.ts` — if one changes, change both. */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(digits[digits.length - 1 - i])]];
  }
  return c === 0;
}

/**
 * BR-04: only the last four digits of an Aadhaar number are ever kept, so only
 * the last four leave this function. The twelve are held for the length of the
 * check-digit sum and dropped.
 *
 * Twelve digits standing alone — the sixteen-digit Virtual ID printed beside
 * the number is four groups, and no three of them are taken for it.
 */
function aadhaarLast4(text: string): string | null {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<!\d[ \t]?)(\d{4})[ \t]?(\d{4})[ \t]?(\d{4})(?![ \t]?\d)/g)) {
    const digits = m[1] + m[2] + m[3];
    if (!'01'.includes(digits[0]) && verhoeffValid(digits)) found.add(digits);
  }
  if (found.size > 1) return null;
  if (found.size === 1) return [...found][0].slice(-4);
  // A masked card — XXXX XXXX 4471 — prints nothing to check, only the four digits.
  const masked = new Set([...text.matchAll(/[Xx*]{4}[ \t]?[Xx*]{4}[ \t]?(\d{4})(?!\d)/g)].map((m) => m[1]));
  return only(masked);
}

/* ------------------------------------------------------------- the rest -- */

function gstin(text: string): string | null {
  return only(
    windows(text, 15, (run) =>
      /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(run) && gstinCheckDigit(run.slice(0, 14)) === run[14] ? run : null,
    ),
  );
}

function ifsc(text: string): string | null {
  const found = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z]{4})[0O]([A-Z0-9]{6})(?![A-Z0-9])/g)) {
    // The fifth character is always a zero. Without a digit after it, this is a word and not a branch code.
    if (/\d/.test(m[2])) found.add(`${m[1]}0${m[2]}`);
  }
  return only(found);
}

function udyam(text: string): string | null {
  const found = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/UDYAM[\s-]*([A-Z]{2})[\s-]*(\d{2})[\s-]*(\d{7})(?!\d)/g)) {
    found.add(`UDYAM-${m[1]}-${m[2]}-${m[3]}`);
  }
  return only(found);
}

const FIND: Partial<Record<Format, (text: string) => string | null>> = { pan, aadhaarLast4, gstin, ifsc, udyam };

/** The one value of this kind in a piece of recognised text, or null when there is none or more than one. */
export function findInText(format: Format, text: string): string | null {
  return FIND[format]?.(text) ?? null;
}

/* -------------------------------------------------------------- reading -- */

/** Upright first, then the two ways a card is held sideways, then upside down. */
const QUARTER_TURNS = [0, 1, 3, 2];

/**
 * Reads what it can of `fields` off a picture, in the browser. Answers in the
 * same shape as the server's reader, so a form cannot tell the two apart.
 */
export async function readLocally(file: Blob, fields: ReadField[]): Promise<Reading> {
  if (file.type === 'application/pdf') {
    throw new Error('A PDF cannot be read on this computer. Choose a photo of the document, or type the details in.');
  }
  const wanted = fields.filter((f) => f.format && READABLE.includes(f.format));
  if (wanted.length === 0) {
    throw new Error('This kind of detail cannot be read without the server’s reader. Type it in by hand.');
  }

  let worker;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');
  } catch {
    throw new Error('The reader could not be loaded — it is fetched from the internet the first time. Try again, or type the details in.');
  }

  const values: Record<string, string> = {};
  try {
    for (const turns of QUARTER_TURNS) {
      const { data } = await worker.recognize(file, { rotateRadians: (turns * Math.PI) / 2 });
      for (const field of wanted) {
        if (values[field.key]) continue;
        const value = findInText(field.format!, data.text);
        if (value) values[field.key] = value;
      }
      if (wanted.every((f) => values[f.key])) break;
    }
  } catch {
    throw new Error('This file could not be read. Type the details in by hand.');
  } finally {
    await worker.terminate();
  }

  return { values, unread: fields.filter((f) => !values[f.key]).map((f) => f.key), notes: {} };
}

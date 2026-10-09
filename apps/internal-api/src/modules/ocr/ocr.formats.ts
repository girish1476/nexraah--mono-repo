import { GSTIN_SHAPE_RE, IFSC_RE, PAN_RE, PHONE_RE, VEHICLE_RE } from '../../common/validation/formats';

/**
 * What a value read off a document has to look like before it is put in front
 * of the checker.
 *
 * The reader is good, but it reads a photograph, and one wrong character in a
 * PAN or a licence number is a wrong PAN. Most Indian identifiers carry enough
 * structure to catch that without asking anyone: a PAN has letters and digits
 * in fixed places, an Aadhaar number and a GSTIN each end in a check digit
 * worked out from the rest. So every value is run through the rule for what it
 * claims to be, and one that fails is left blank for the checker to type — the
 * module's standing rule is that a blank is better than a guess.
 *
 * Nothing here talks to the reader or to the network; it is all plain
 * functions, which is what lets `ocr.formats.test.ts` hold it to account.
 */

export const OCR_FIELD_FORMATS = [
  'pan',
  'aadhaarLast4',
  'gstin',
  'vehicle',
  'drivingLicence',
  'ifsc',
  'bankAccount',
  'ewayBill',
  'udyam',
  'phone',
  'pincode',
  'name',
] as const;
export type OcrFieldFormat = (typeof OCR_FIELD_FORMATS)[number];

/** A value that passed (`value`), or did not (`null`). `note` is something the checker should be told either way. */
export interface Checked {
  value: string | null;
  note?: string;
}

const pass = (value: string, note?: string): Checked => (note ? { value, note } : { value });
const fail = (note?: string): Checked => (note ? { value: null, note } : { value: null });

/** Capitals, with the spaces, hyphens, dots and slashes a printed number is broken up by taken out. */
const compact = (raw: string) => raw.toUpperCase().replace(/[\s\-./]/g, '');

/** Characters a photograph makes look alike, each way round. */
const AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };
const AS_DIGIT: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };

/**
 * Puts a look-alike right where the pattern leaves no doubt which it is: in a
 * PAN the fifth character is a letter, so a `0` there is an `O`. `shape` is one
 * character per position — `A` letter, `9` digit, anything else left alone.
 */
function settle(value: string, shape: string): { value: string; changed: boolean } {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (shape[i] === 'A') out += AS_LETTER[ch] ?? ch;
    else if (shape[i] === '9') out += AS_DIGIT[ch] ?? ch;
    else out += ch;
  }
  return { value: out, changed: out !== value };
}

const SETTLED = 'A character that can be read two ways was settled by the pattern — check it against the document.';

/* ------------------------------------------------------------------ PAN -- */

/** The fourth letter says who holds the PAN: a person, a company, a firm, a trust… */
const PAN_HOLDER = 'PCHFATBLJG';

function pan(raw: string): Checked {
  const c = compact(raw);
  if (c.length !== 10) return fail();
  const { value, changed } = settle(c, 'AAAAA9999A');
  if (!PAN_RE.test(value)) return fail();
  if (!PAN_HOLDER.includes(value[3])) {
    return pass(value, 'The fourth letter is not one a PAN uses — check it against the card.');
  }
  return pass(value, changed ? SETTLED : undefined);
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

/** The Verhoeff check an Aadhaar number ends in — it catches any single wrong digit and any two swapped. */
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
 * the last four ever leave this function.
 *
 * The reader is asked for the number as printed so that the whole of it can be
 * put through Aadhaar's own check digit — that is what tells a clean read from
 * one with a digit wrong, and four digits on their own cannot be checked at
 * all. The twelve digits exist here for the length of that sum and are then
 * dropped: not returned, not logged, not stored.
 */
function aadhaarLast4(raw: string): Checked {
  const c = compact(raw).replace(/[*•]/g, 'X');
  if (/^\d{4}$/.test(c)) return pass(c);
  // A masked card — XXXX XXXX 4471 — prints nothing to check, only the four digits.
  if (/^X{8}\d{4}$/.test(c)) return pass(c.slice(-4));
  // Sixteen digits is the Virtual ID printed beside the number, not the number.
  if (!/^\d{12}$/.test(c)) return fail();
  if ('01'.includes(c[0]) || !verhoeffValid(c)) {
    return fail('The number read off the card did not pass Aadhaar’s own check, so it was left blank — type the last four digits.');
  }
  return pass(c.slice(-4));
}

/* ---------------------------------------------------------------- GSTIN -- */

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The GSTIN check digit. Mirrors the portal's `lib/gstin.ts` — if one changes, change both. */
export function gstinCheckDigit(first14: string): string {
  let total = 0;
  let mul = 1;
  for (const ch of first14) {
    const product = BASE36.indexOf(ch) * mul;
    total += Math.floor(product / 36) + (product % 36);
    mul = mul === 1 ? 2 : 1;
  }
  return BASE36[(36 - (total % 36)) % 36];
}

/**
 * For a typed GSTIN the check digit is advisory (part 13 §2) — a person may
 * hold one that looks odd. For one read off a photograph it is the opposite:
 * a check digit that does not match means a character was misread.
 */
function gstin(raw: string): Checked {
  const c = compact(raw);
  if (c.length !== 15) return fail();
  const { value, changed } = settle(c, '99AAAAA9999A?Z?');
  if (!GSTIN_SHAPE_RE.test(value)) return fail();
  if (gstinCheckDigit(value.slice(0, 14)) !== value[14]) {
    return fail('The GSTIN read off the document did not pass its own check digit, so it was left blank.');
  }
  return pass(value, changed ? SETTLED : undefined);
}

/* ------------------------------------------------------ vehicle, licence -- */

/** MH15GT4482, DL1LAB1234, the older MH154482 — and 22BH1234AA for the Bharat series. */
const VEHICLE_STATE_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
const VEHICLE_BH_RE = /^\d{2}BH\d{4}[A-Z]{1,2}$/;

function vehicle(raw: string): Checked {
  const c = compact(raw);
  if (VEHICLE_STATE_RE.test(c) || VEHICLE_BH_RE.test(c)) return pass(c);
  // Same latitude as the API gives a typed plate: an unusual one is shown, and said to be unusual.
  if (VEHICLE_RE.test(c) && /\d/.test(c)) {
    return pass(c, 'This does not look like a usual registration number — check it against the document.');
  }
  return fail();
}

/** MH1420110012345 — state, RTO, year of issue, serial. Older licences vary, so the loose form is let through with a note. */
const DL_STANDARD_RE = /^[A-Z]{2}\d{2}(19|20)\d{2}\d{7}$/;
const DL_LOOSE_RE = /^[A-Z]{2}[A-Z0-9]{7,16}$/;

function drivingLicence(raw: string): Checked {
  const c = compact(raw);
  if (DL_STANDARD_RE.test(c)) return pass(c);
  if (DL_LOOSE_RE.test(c) && /\d{5}/.test(c)) {
    return pass(c, 'This is not in the usual licence number format (older licences are not) — check it against the licence.');
  }
  return fail();
}

/* ------------------------------------------------------------- the rest -- */

function ifsc(raw: string): Checked {
  const c = compact(raw);
  if (c.length !== 11) return fail();
  // The fifth character is always a zero; on a cheque it is often read as the letter.
  const value = c.slice(0, 4) + (c[4] === 'O' ? '0' : c[4]) + c.slice(5);
  if (!IFSC_RE.test(value)) return fail();
  return pass(value, value !== c ? SETTLED : undefined);
}

function bankAccount(raw: string): Checked {
  const c = compact(raw);
  return /^\d{9,18}$/.test(c) ? pass(c) : fail();
}

function ewayBill(raw: string): Checked {
  const c = compact(raw);
  return /^\d{12}$/.test(c) ? pass(c) : fail();
}

function udyam(raw: string): Checked {
  const m = /^UDYAM([A-Z]{2})(\d{2})(\d{7})$/.exec(compact(raw));
  return m ? pass(`UDYAM-${m[1]}-${m[2]}-${m[3]}`) : fail();
}

function phone(raw: string): Checked {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return PHONE_RE.test(digits) ? pass(digits) : fail();
}

function pincode(raw: string): Checked {
  const digits = raw.replace(/\D/g, '');
  return /^[1-9]\d{5}$/.test(digits) ? pass(digits) : fail();
}

function name(raw: string): Checked {
  const value = raw.replace(/\s+/g, ' ').trim();
  // A name with a run of digits in it is a number that was read into the wrong box.
  if (value.length < 2 || /\d{3}/.test(value)) return fail();
  return pass(value.slice(0, 120));
}

const CHECKS: Record<OcrFieldFormat, (raw: string) => Checked> = {
  pan,
  aadhaarLast4,
  gstin,
  vehicle,
  drivingLicence,
  ifsc,
  bankAccount,
  ewayBill,
  udyam,
  phone,
  pincode,
  name,
};

export function checkFormat(format: OcrFieldFormat, raw: string): Checked {
  return CHECKS[format](raw);
}

/* ---------------------------------------------------------------- dates -- */

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** A real day of a real month — `2027-02-30` is neither, though `Date.parse` takes it. */
export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const iso = (y: number, mo: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Every date written out in a piece of printed text, read the Indian way — day
 * first. `31/03/2027`, `31-03-2027`, `31.03.2027`, `31-Mar-2027`,
 * `31 March 2027` and `2027-03-31` are all understood. A two-digit year is
 * not: `31/03/27` does not say which century, so it is not guessed at.
 */
export function printedDates(text: string): string[] {
  const found: string[] = [];
  const push = (y: number, mo: number, d: number) => {
    const value = iso(y, mo, d);
    if (isRealDate(value)) found.push(value);
  };
  const re =
    /(?<![\d/.-])(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})|(\d{1,2})[\s/.-]*([A-Za-z]{3,9})[\s/.,-]*(\d{4}))(?![\d/-])/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) push(Number(m[1]), Number(m[2]), Number(m[3]));
    else if (m[4]) push(Number(m[6]), Number(m[5]), Number(m[4]));
    else {
      const month = MONTHS[m[8].toUpperCase().slice(0, 4)] ?? MONTHS[m[8].toUpperCase().slice(0, 3)];
      if (month) push(Number(m[9]), month, Number(m[7]));
    }
  }
  return found;
}

/**
 * The one mistake a careful reader still makes with a date is turning
 * `04/03/2027` round into April. So the reader is asked for the date twice —
 * as it is printed, and as YYYY-MM-DD — and the printed form is worked out
 * again here, day first. Where the two disagree the printed one wins: it is
 * the document, and this reading of it cannot get the order wrong.
 *
 * Only done when the printed text holds exactly one date. "01/04/2026 to
 * 31/03/2027" holds two, and which of them was asked for is the reader's call.
 */
export function settleDate(value: string, printed: string | null | undefined): Checked {
  const fromPrint = printed ? printedDates(printed) : [];
  if (fromPrint.length === 1 && fromPrint[0] !== value) {
    return pass(fromPrint[0], 'The day and month were taken from the date as printed — check it against the document.');
  }
  return isRealDate(value) ? pass(value) : fail();
}

/* -------------------------------------------------------------- amounts -- */

/** `₹ 1,25,000.50`, `Rs. 125000/-`, `12.480 MT` → digits and at most one decimal point. */
export function settleNumber(raw: string): Checked {
  const digits = raw
    .replace(/(rs\.?|inr|₹)/gi, '')
    .replace(/\/-$/, '')
    .replace(/[,\s]/g, '')
    .replace(/(mt|kgs?|tonnes?|tons?|nos?|pkgs?)\.?$/i, '');
  return /^\d+(\.\d+)?$/.test(digits) ? pass(digits) : fail();
}

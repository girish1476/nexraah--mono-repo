import type { ReadField } from '@/lib/attachments';
// The same rules the server puts a reading through — plain functions, no dependencies.
import { checkFormat, printedDates } from '../../../../internal-api/src/modules/ocr/ocr.formats';

/**
 * Picks the details a form asks for out of a document's text.
 *
 * The text comes from `text.ts` — a PDF's own text, or a photo read by the
 * open-source reader in the browser. Nothing here understands a document the
 * way a person does: it looks for each detail by its shape (a GSTIN is fifteen
 * characters in a fixed pattern) and by the words printed beside it ("Invoice
 * No", "Valid upto"). What it finds is then put through the same checks the
 * server applies (`settleReading`), so a GSTIN with a wrong check digit or a
 * date that is not a date is left blank.
 *
 * A blank is better than a guess: where a detail cannot be told apart from
 * something else on the page, it is left for the person to type.
 */

export interface Found {
  /** The value in the form asked for: a date as YYYY-MM-DD, a number as digits. */
  value: string | null;
  /** The same thing as it is printed. */
  printed: string | null;
}

const NOTHING: Found = { value: null, printed: null };

interface Hit {
  raw: string;
  at: number;
}

const all = (text: string, re: RegExp): Hit[] => [...text.matchAll(re)].map((m) => ({ raw: m[0], at: m.index ?? 0 }));

/** Where any of these words is printed, earliest first. */
function cueEnds(text: string, cues: RegExp[]): number[] {
  const ends: number[] = [];
  for (const cue of cues) {
    const re = new RegExp(cue.source, cue.flags.includes('g') ? cue.flags : `${cue.flags}g`);
    for (const m of text.matchAll(re)) ends.push((m.index ?? 0) + m[0].length);
  }
  return ends.sort((a, b) => a - b);
}

/** The first hit printed within `reach` characters after one of the cue words. */
function afterCue(text: string, cues: RegExp[], hits: Hit[], reach = 90): Hit | null {
  for (const end of cueEnds(text, cues)) {
    const hit = hits.find((h) => h.at >= end && h.at - end <= reach);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------- numbers of a known kind -- */

type Format = NonNullable<ReadField['format']>;

/** Loose shapes: anything that might be the number. Each is then checked properly. */
const SHAPE: Partial<Record<Format, RegExp>> = {
  gstin: /\b[0-9OIZSB]{2}[A-Z0-9]{5}[0-9OIZSB]{4}[A-Z0-9][1-9A-Z][Z2][0-9A-Z]\b/g,
  pan: /\b[A-Z0-9]{5}[0-9OIZSB]{4}[A-Z0-9]\b/g,
  vehicle: /\b(?:[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}|\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2})\b/g,
  drivingLicence: /\b[A-Z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}[\s-]?\d{7}\b/g,
  ifsc: /\b[A-Z]{4}[0O][A-Z0-9]{6}\b/g,
  udyam: /\bUDYAM[\s-]?[A-Z]{2}[\s-]?\d{2}[\s-]?\d{7}\b/g,
  ewayBill: /(?<![\d-])\d{4}\s?\d{4}\s?\d{4}(?![\d-])/g,
  aadhaarLast4: /(?<![\d-])(?:\d{4}|[X*]{4})\s?(?:\d{4}|[X*]{4})\s?\d{4}(?![\d-])/g,
  bankAccount: /(?<![\d-])\d{9,18}(?![\d-])/g,
  phone: /(?<![\d-])[6-9]\d{9}(?![\d-])/g,
  pincode: /(?<![\d-])[1-9]\d{5}(?![\d-])/g,
};

/** The words printed beside a number of each kind. */
const FORMAT_CUES: Partial<Record<Format, RegExp[]>> = {
  gstin: [/GSTIN|GST\s*(?:NO|NUMBER|IN)\b/i],
  pan: [/PERMANENT ACCOUNT NUMBER|\bPAN\b/i],
  vehicle: [/(?:VEHICLE|TRUCK|LORRY|REGN?\.?|REGISTRATION)\s*(?:NO|NUMBER|#)?/i],
  drivingLicence: [/(?:DL|LICEN[CS]E)\s*(?:NO|NUMBER|#)?/i],
  ifsc: [/IFSC?\b/i],
  ewayBill: [/E-?\s*WAY\s*BILL\s*(?:NO|NUMBER|#)?|\bEWB\b/i],
  aadhaarLast4: [/AADHAA?R|UIDAI|YOUR AADHAAR/i],
  bankAccount: [/(?:A\/C|ACCOUNT|ACCT)\.?\s*(?:NO|NUMBER|#)?/i],
  phone: [/MOBILE|PHONE|CONTACT|TEL\b/i],
  pincode: [/PIN\s*(?:CODE)?/i],
};

/**
 * A PAN or a GSTIN read by eye has at most a character or two that could be
 * read two ways (O for 0). A ten-digit phone number is not a PAN with seven
 * misread characters, so a candidate that far from the shape is not offered.
 */
function close(raw: string, shape: string, allowed = 2): boolean {
  if (raw.length !== shape.length) return false;
  let off = 0;
  for (let i = 0; i < shape.length; i++) {
    const want = shape[i];
    const isDigit = /\d/.test(raw[i]);
    if ((want === 'A' && isDigit) || (want === '9' && !isDigit)) off += 1;
  }
  return off <= allowed;
}
const NEAR: Partial<Record<Format, string>> = { gstin: '99AAAAA9999AXXX', pan: 'AAAAA9999A' };

/** Whose number is asked for, where a page carries more than one of a kind. */
function whose(label: string): RegExp[] {
  const l = label.toLowerCase();
  if (/consignor|supplier|seller|from/.test(l)) return [/CONSIGNOR|SUPPLIER|SELLER|DISPATCH FROM|\bFROM\b|BILL(?:ED)? FROM/i];
  if (/consignee|buyer|recipient|ship to|bill to/.test(l)) return [/CONSIGNEE|BUYER|RECIPIENT|SHIP(?:PED)? TO|BILL(?:ED)? TO|\bTO\b/i];
  return [];
}

function numberOfKind(text: string, field: ReadField, format: Format): Found {
  const upper = text.toUpperCase();
  const shape = SHAPE[format];
  if (!shape) return NOTHING;
  const near = NEAR[format];
  const hits = all(upper, shape).filter((h) => !near || close(h.raw, near));
  const good = hits.filter((h) => checkFormat(format, h.raw).value);
  if (good.length === 0) return NOTHING;

  // The one beside the words that name whose it is, then the one beside the words that name what it is.
  const party = whose(field.label);
  const cues = FORMAT_CUES[format] ?? [];
  const beside = (party.length ? afterCue(upper, party, good, 220) : null) ?? afterCue(upper, cues, good);
  if (beside) return { value: beside.raw, printed: beside.raw };

  // No words to go by. A number with a shape of its own is taken where it is
  // printed first; a plain run of digits only when it is the only one there.
  const distinct = new Set(good.map((h) => h.raw.replace(/[\s-]/g, '')));
  const ownShape = ['gstin', 'pan', 'vehicle', 'drivingLicence', 'ifsc', 'udyam'].includes(format);
  if (ownShape || distinct.size === 1) return { value: good[0].raw, printed: good[0].raw };
  return NOTHING;
}

/* ------------------------------------------------------------------ dates -- */

const DATE_RE =
  /(?<![\d/.-])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}[\s/.-]*[A-Za-z]{3,9}[\s/.,-]*\d{4})(?![\d/-])/g;

const RUNS_OUT = /valid|expir|till|up\s?to|until/i;
const RUNS_OUT_WORDS = /VALID|EXPIR|UP\s?TO|TILL|UNTIL|DUE/;
const STARTS_WORDS = /ISSUE|FROM|REGISTR|EFFECTIVE|\bDATED?\b|COMMENC/;

/** The paper a date belongs to, where one file holds several (a truck's papers in one PDF). */
const SUBJECTS: [RegExp, RegExp][] = [
  [/fitness/i, /FITNESS|\bFC\b/],
  [/insurance|\bic\b/i, /INSURANCE|POLICY|\bIC\b/],
  [/permit/i, /PERMIT/],
  [/pollution|puc/i, /POLLUTION|PUCC?\b|EMISSION/],
  [/tax/i, /\bTAX\b/],
  [/licen[cs]e|\bdl\b/i, /LICEN[CS]E|\bDL\b|NON-?TRANSPORT|TRANSPORT/],
];

function dateFor(text: string, field: ReadField): Found {
  const hits = all(text, DATE_RE)
    .map((h) => ({ ...h, iso: printedDates(h.raw)[0] }))
    .filter((h) => h.iso);
  if (hits.length === 0) return NOTHING;

  const upper = text.toUpperCase();
  const subject = SUBJECTS.find(([inLabel]) => inLabel.test(field.label))?.[1] ?? null;
  const wantsEnd = RUNS_OUT.test(field.label);

  // What is printed before each date on its own line — "Fitness Upto:". Where
  // the date stands alone on its line, the words are on the line above it.
  const scored = hits.map((h) => {
    const lineStart = upper.lastIndexOf('\n', h.at - 1);
    const sameLine = upper.slice(lineStart + 1, h.at);
    const above = upper.lastIndexOf('\n', Math.max(0, lineStart - 1));
    const before = /[A-Z]{3}/.test(sameLine) ? sameLine : upper.slice(above + 1, h.at);
    let score = 0;
    if (subject && subject.test(before)) score += 4;
    if (wantsEnd && RUNS_OUT_WORDS.test(sameLine)) score += 3;
    else if (wantsEnd && RUNS_OUT_WORDS.test(before)) score += 2;
    if (!wantsEnd && STARTS_WORDS.test(before)) score += 2;
    // "From 01/04/2026 To 31/03/2027": the second of a pair is when it ends.
    if (wantsEnd && /\b(?:TO|-|–)\s*$/.test(sameLine)) score += 2;
    return { ...h, score };
  });

  const distinct = [...new Set(scored.map((s) => s.iso))];
  const take = (h: (typeof scored)[number]): Found => ({ value: h.iso, printed: h.raw });
  if (distinct.length === 1) return take(scored[0]);

  // Several dates: one of them has to be marked out by the words beside it.
  const needed = subject ? 5 : 2;
  const best = Math.max(...scored.map((s) => s.score));
  if (best < needed) return NOTHING;
  const top = scored.filter((s) => s.score === best);
  const topDates = [...new Set(top.map((s) => s.iso))];
  if (topDates.length === 1) return take(top[0]);
  // Two dates marked alike ("Valid from … to …"): a paper runs out on the later one.
  if (wantsEnd) return take(top.reduce((a, b) => (a.iso > b.iso ? a : b)));
  return NOTHING;
}

/* ----------------------------------------------------- amounts and counts -- */

const NUMBER_RE = /(?<![A-Za-z\d])(?:₹|RS\.?|INR)?\s*(\d[\d,]*(?:\.\d+)?)\s*(MT|TONNES?|TONS?|KGS?|QTLS?|NOS?|PKGS?)?\.?/gi;

/** The words printed beside an amount, a weight or a count, by what the box is called. */
function numberCues(label: string): RegExp[] {
  const l = label.toLowerCase();
  if (/invoice value|value|amount/.test(l))
    return [/GRAND\s*TOTAL/i, /TOTAL\s*(?:INVOICE)?\s*(?:VALUE|AMOUNT)/i, /INVOICE\s*(?:VALUE|AMOUNT)/i, /(?:NET\s*)?AMOUNT\s*PAYABLE/i, /TOTAL\s*(?:INV\.?)?\s*(?:AMT|VALUE)/i, /\bTOTAL\b/i];
  if (/net weight/.test(l)) return [/NET\s*(?:WEIGHT|WT)\.?/i];
  if (/weight/.test(l)) return [/(?:NET|LOADED|ACTUAL|CHARGED)\s*(?:WEIGHT|WT)\.?/i, /\bWEIGHT\b|\bWT\b\.?/i, /\bQTY\b|QUANTITY/i];
  if (/package/.test(l)) return [/(?:NO\.?\s*OF\s*)?(?:PACKAGES|PKGS|BAGS|BOXES|CARTONS|ARTICLES)/i];
  return [];
}

function numberFor(text: string, field: ReadField): Found {
  const cues = numberCues(field.label);
  if (cues.length === 0) return NOTHING;
  const wantsTonnes = /\(mt\)|tonne|weight/i.test(field.label);
  for (const cue of cues) {
    for (const end of cueEnds(text, [cue])) {
      // The figure beside the words: on the same line, after them.
      const lineEnd = text.indexOf('\n', end);
      const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
      const figures = [...rest.matchAll(NUMBER_RE)].filter((m) => m[1] && /\d/.test(m[1]));
      if (figures.length === 0) continue;
      // An amount is the last figure on its line ("Total 2 bags 1,25,000.00"); a weight or a count is the first.
      const m = field.type === 'rupees' ? figures[figures.length - 1] : figures[0];
      const digits = m[1].replace(/,/g, '');
      const unit = (m[2] ?? '').toUpperCase();
      if (wantsTonnes && /^KG/.test(unit)) {
        const tonnes = Number(digits) / 1000;
        return { value: String(Number(tonnes.toFixed(3))), printed: m[0].trim() };
      }
      if (wantsTonnes && /^QTL/.test(unit)) {
        return { value: String(Number((Number(digits) / 10).toFixed(3))), printed: m[0].trim() };
      }
      return { value: digits, printed: m[0].trim() };
    }
  }
  return NOTHING;
}

/* ----------------------------------------------- names and reference numbers -- */

const FILLER = new Set(['number', 'no', 'of', 'this', 'document', 'or', 'other', 'the', 'on', 'it', 'name', 'and', 'a', 'an']);

/** The words a label is known by on paper: "LR number" is also "GR No", "Consignment Note No". */
function referenceCues(label: string): RegExp[] {
  const l = label.toLowerCase();
  const no = '\\s*(?:NO|NUMBER|NUM|#|ID)\\b\\.?';
  if (/\blr\b|lorry receipt/.test(l)) return [new RegExp(`(?:L\\.?\\s?R\\.?|G\\.?\\s?R\\.?|C\\.?\\s?N\\.?|CONSIGNMENT(?:\\s*NOTE)?|LORRY RECEIPT|BILTY|DOCKET)${no}`, 'i')];
  if (/invoice/.test(l)) return [new RegExp(`(?:TAX\\s*)?INVOICE${no}`, 'i'), new RegExp(`\\bINV\\.?${no}`, 'i'), new RegExp(`\\bBILL${no}`, 'i')];
  if (/slip/.test(l)) return [new RegExp(`(?:SLIP|TICKET|SERIAL|SL\\.?|RECEIPT|CHALLAN|RST)${no}`, 'i')];
  const words = l
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w));
  if (words.length === 0) return [];
  return [new RegExp(`(?:${words.map((w) => w.toUpperCase()).join('|')})${no}`, 'i')];
}

function referenceFor(text: string, field: ReadField): Found {
  for (const cue of referenceCues(field.label)) {
    for (const end of cueEnds(text, [cue])) {
      const lineEnd = text.indexOf('\n', end);
      const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
      // A reference number has a digit in it; a word after the label is not one.
      const m = rest.match(/^[\s:.\-–#]*([A-Za-z0-9][A-Za-z0-9/\-_.]{1,29})/);
      if (m && /\d/.test(m[1])) {
        const value = m[1].replace(/[.\-_/]+$/, '');
        return { value, printed: value };
      }
    }
  }
  return NOTHING;
}

function nameCues(label: string): RegExp[] {
  const l = label.toLowerCase();
  if (/consignee/.test(l)) return [/CONSIGNEE(?:'?S)?(?:\s*NAME)?/i, /SHIP(?:PED)?\s*TO/i, /BILL(?:ED)?\s*TO/i];
  if (/consignor/.test(l)) return [/CONSIGNOR(?:'?S)?(?:\s*NAME)?/i];
  if (/driver/.test(l)) return [/DRIVER(?:'?S)?\s*NAME/i, /NAME\s*OF\s*(?:THE\s*)?(?:DRIVER|HOLDER)/i, /\bNAME\b/i];
  if (/account holder/.test(l)) return [/ACCOUNT\s*HOLDER(?:'?S)?(?:\s*NAME)?/i, /A\/C\s*(?:HOLDER|NAME)/i, /NAME\s*OF\s*(?:THE\s*)?ACCOUNT\s*HOLDER/i, /CUSTOMER\s*NAME/i];
  return [/\bNAME\b/i];
}

function nameFor(text: string, field: ReadField): Found {
  for (const cue of nameCues(field.label)) {
    for (const end of cueEnds(text, [cue])) {
      const lineEnd = text.indexOf('\n', end);
      const sameLine = text.slice(end, lineEnd === -1 ? text.length : lineEnd).replace(/^[\s:.\-–]+/, '').trim();
      // Beside the label, or on the line under it when the label stands alone.
      const next = lineEnd === -1 ? '' : (text.slice(lineEnd + 1).split('\n')[0] ?? '').trim();
      const candidate = (sameLine.length >= 3 ? sameLine : next).replace(/\s{2,}.*$/, '').trim();
      if (candidate.length < 3 || candidate.length > 80 || /\d{3,}/.test(candidate)) continue;
      const checked = field.format === 'name' ? checkFormat('name', candidate).value : candidate;
      if (checked) return { value: checked, printed: candidate };
    }
  }
  return NOTHING;
}

/* ------------------------------------------------------------------ whole -- */

export function extractFields(text: string, fields: ReadField[]): Record<string, Found> {
  // A reader leaves stray spaces and blank lines; the rules above go by lines.
  const clean = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  const found: Record<string, Found> = {};
  for (const field of fields) {
    const type = field.type ?? 'text';
    if (type === 'date') found[field.key] = dateFor(clean, field);
    else if (type === 'number' || type === 'rupees') found[field.key] = numberFor(clean, field);
    else if (field.format === 'name' || /\bname\b/i.test(field.label)) found[field.key] = nameFor(clean, field);
    else if (field.format) found[field.key] = numberOfKind(clean, field, field.format);
    else found[field.key] = referenceFor(clean, field);
  }
  return found;
}

import type { ReadField, Reading } from '@/lib/attachments';
// The server's own checks — plain functions, so they are used here as they are.
import { checkFormat, settleDate, settleNumber, type Checked } from '../../../../internal-api/src/modules/ocr/ocr.formats';
import { extractFields, type Found } from './extract';
import { documentText } from './text';

export { ReaderUnavailable } from './text';

/** Today's date where the documents are — a paper that ran out yesterday in India has run out. */
const todayInIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** A date box whose date matters because the paper stops being good after it. */
const RUNS_OUT = /valid|expir|till|up\s?to/i;
const EXPIRED = 'This date has already passed — the document has run out.';

/**
 * One found detail, checked — the same rule as the server's `settleReading`
 * (apps/internal-api/src/modules/ocr/ocr.reading.ts): a value is passed on only
 * if it is the kind the box takes and, for a known kind of number, only if it
 * passes that number's own check.
 */
function settle(field: ReadField, found: Found | undefined, today: string): Checked {
  const value = (found?.value ?? '').trim();
  if (!value) return { value: null };
  switch (field.type ?? 'text') {
    case 'date': {
      const date = settleDate(value, found?.printed);
      if (date.value && date.value < today && RUNS_OUT.test(field.label)) {
        return { value: date.value, note: date.note ? `${EXPIRED} ${date.note}` : EXPIRED };
      }
      return date;
    }
    case 'number':
    case 'rupees':
      return settleNumber(value);
    default:
      return field.format ? checkFormat(field.format, value) : { value: value.replace(/\s+/g, ' ').slice(0, 200) };
  }
}

/** The details asked for, out of a document's text, each passed through its own check. */
export function readText(text: string, fields: ReadField[], today = todayInIndia()): Reading {
  const found = extractFields(text, fields);
  const reading: Reading = { values: {}, unread: [], notes: {} };
  for (const field of fields) {
    const checked = settle(field, found[field.key], today);
    if (checked.value) reading.values[field.key] = checked.value;
    else reading.unread.push(field.key);
    if (checked.note) reading.notes[field.key] = checked.note;
  }
  return reading;
}

/**
 * Reads the details a form asks for off a file, in the browser.
 *
 * The free stand-in for the server's reader: the same answer shape, the same
 * checks on what is found, nothing sent anywhere. It only suggests — the person
 * verifying the document still looks at each value before saving.
 */
export async function readDetails(blob: Blob, mime: string, fields: ReadField[]): Promise<Reading> {
  return readText(await documentText(blob, mime), fields);
}

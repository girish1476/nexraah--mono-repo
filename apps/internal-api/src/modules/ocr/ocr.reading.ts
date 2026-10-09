import type { OcrFieldDto, OcrReading } from './ocr.dto';
import { checkFormat, settleDate, settleNumber, type Checked } from './ocr.formats';

/** One detail as the reader gives it back: the value in the form asked for, and the same thing as it is printed. */
export interface ReadField {
  value: string | null;
  printed: string | null;
}

/** A date box whose date matters because the paper stops being good after it. */
const RUNS_OUT = /valid|expir|till|up\s?to/i;
const EXPIRED = 'This date has already passed — the document has run out.';

/**
 * Turns what the reader gave back into what the form is shown.
 *
 * A value is only passed on if it is the kind the box takes, and — where the
 * box holds a known kind of number — only if it passes that number's own
 * check. A date that is not a date, an amount with letters in it or a GSTIN
 * whose check digit is wrong is dropped rather than put in front of the
 * checker as if it had been read.
 *
 * `today` is YYYY-MM-DD, passed in so this stays a plain function of its
 * arguments.
 */
export function settleReading(
  fields: OcrFieldDto[],
  read: Record<string, ReadField | null | undefined>,
  today: string,
): OcrReading {
  const reading: OcrReading = { values: {}, unread: [], notes: {} };
  for (const field of fields) {
    const checked = settleField(field, read[field.key], today);
    if (checked.value) reading.values[field.key] = checked.value;
    else reading.unread.push(field.key);
    if (checked.note) reading.notes[field.key] = checked.note;
  }
  return reading;
}

function settleField(field: OcrFieldDto, read: ReadField | null | undefined, today: string): Checked {
  const value = (read?.value ?? '').trim();
  if (!value) return { value: null };
  switch (field.type ?? 'text') {
    case 'date': {
      const date = settleDate(value, read?.printed);
      if (date.value && date.value < today && RUNS_OUT.test(field.label)) {
        return { value: date.value, note: date.note ? `${EXPIRED} ${date.note}` : EXPIRED };
      }
      return date;
    }
    case 'number':
    case 'rupees':
      return settleNumber(value);
    default:
      return field.format
        ? checkFormat(field.format, value)
        : { value: value.replace(/\s+/g, ' ').slice(0, 200) };
  }
}

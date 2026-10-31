import { Transform } from 'class-transformer';

/**
 * Kept apart from `formats.ts`, which must import nothing: the console reads
 * that file too (through `modules/ocr/ocr.formats.ts`, for its free document
 * reader), and the console's own build has no `class-transformer` — Vercel
 * refused the build when this lived there (31 Oct 2026).
 *
 * An optional box left empty on a form arrives as `""`. `@IsOptional()` skips
 * only null and undefined, so the shape check under it refused the empty
 * string as a malformed GSTIN, date or phone — and the whole save with it.
 * This makes an empty (or all-space) value mean "not given".
 *
 * For create bodies and whole-section saves only: on a PATCH, `""` can mean
 * "clear this", and those keep their own handling.
 */
export const BlankAsAbsent = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

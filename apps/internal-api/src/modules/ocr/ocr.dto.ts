import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { OCR_FIELD_FORMATS, type OcrFieldFormat } from './ocr.formats';
import { OCR_DOC_TYPES, type OcrDocType } from './ocr.profiles';

export const OCR_FIELD_TYPES = ['text', 'date', 'number', 'rupees'] as const;
export type OcrFieldType = (typeof OCR_FIELD_TYPES)[number];

/** One box of the verify form: what it is called on screen, and what kind of value it takes. */
export class OcrFieldDto {
  @Matches(/^[A-Za-z][A-Za-z0-9]{0,39}$/) key!: string;
  @IsString() @MaxLength(80) label!: string;
  @IsOptional() @IsIn(OCR_FIELD_TYPES as unknown as string[]) type?: OcrFieldType;
  /** For a text box that holds a known kind of number — a PAN, a GSTIN — the rule it is checked against once read. */
  @IsOptional() @IsIn(OCR_FIELD_FORMATS as unknown as string[]) format?: OcrFieldFormat;
}

/**
 * `POST /attachments/:id/read` and `POST /attachments/read` — which details to
 * read off the document.
 */
export class ReadDocumentDto {
  /** What the document is, in the screen's own words — "E-way bill". */
  @IsString() @MaxLength(80) document!: string;

  /** Which kind of paper it is, so the reader is told where on it to look. */
  @IsOptional() @IsIn(OCR_DOC_TYPES as unknown as string[]) docType?: OcrDocType;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(16) @ValidateNested({ each: true }) @Type(() => OcrFieldDto)
  fields!: OcrFieldDto[];
}

/** What a read answers with. Nothing is saved — these are suggestions for boxes a person then checks. */
export interface OcrReading {
  /** What could be read and passed its check: dates as YYYY-MM-DD, amounts in rupees. */
  values: Record<string, string>;
  /** The boxes left for the checker to type. */
  unread: string[];
  /** Something to tell the checker about a box, read or not — "this date has already passed". */
  notes: Record<string, string>;
}

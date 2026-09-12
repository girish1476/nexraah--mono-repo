import { IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import {
  MAX_SUBJECT,
  MIN_DETAIL,
  MIN_SUBJECT,
  TICKET_KINDS,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  type TicketKind,
  type TicketSeverity,
  type TicketStatus,
} from './ticket-rules';

export class RaiseTicketDto {
  @IsString() @Length(MIN_SUBJECT, MAX_SUBJECT) subject!: string;

  /** The floor the approvals engine uses for a reason, for the same reason. */
  @IsString() @MinLength(MIN_DETAIL) detail!: string;

  @IsOptional() @IsIn(TICKET_KINDS as unknown as string[]) kind?: TicketKind;
  @IsOptional() @IsIn(TICKET_SEVERITIES as unknown as string[]) severity?: TicketSeverity;

  /**
   * The console route the reporter was looking at. Sent by the client, not
   * typed by the person — a report that arrives without it is unactionable,
   * so it is required rather than optional.
   */
  @IsString() @MaxLength(300) raisedOnPath!: string;

  /** The record the screen was showing, when there was one. */
  @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsString() @MaxLength(100) entityId?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(TICKET_STATUSES as unknown as string[]) status?: TicketStatus;
  @IsOptional() @IsIn(TICKET_SEVERITIES as unknown as string[]) severity?: TicketSeverity;

  /**
   * Deliberately not `@MinLength` here. The length rule depends on the status
   * being moved to — a note is required for RESOLVED and WONT_FIX and
   * meaningless for IN_PROGRESS — so it lives in `checkTransition`, which
   * knows both, and answers with a sentence rather than a field error.
   */
  @IsOptional() @IsString() @MaxLength(2000) resolution?: string;
}

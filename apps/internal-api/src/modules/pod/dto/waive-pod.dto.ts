import { IsString, MinLength } from 'class-validator';

/** BR-43: compliance proposes with a ≥30-char reason; leadership approves. */
export class WaivePodDto {
  @IsString() @MinLength(30) reason!: string;
}

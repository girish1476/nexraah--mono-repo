import { IsString, MinLength } from 'class-validator';

export class RejectClientDto {
  /** Recorded against the client and shown whenever their file is opened, so
   *  "why did we decline them?" has an answer a year later. */
  @IsString()
  @MinLength(10, { message: 'Give a real reason — it is recorded against the client.' })
  reason!: string;
}

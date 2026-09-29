import { IsString, MinLength } from 'class-validator';

/** Cancelling (or reassigning) always says why — the remark is what anybody reads later. */
export class CancelIndentDto {
  @IsString() @MinLength(5) reason!: string;
}

import { IsString, MinLength } from 'class-validator';

export class RejectTripDocumentDto {
  @IsString() @MinLength(1) reason!: string;
}

import { IsString, MinLength } from 'class-validator';

export class RejectPodDto {
  @IsString() @MinLength(1) reason!: string;
}

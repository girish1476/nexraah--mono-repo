import { IsUUID } from 'class-validator';

export class AssignLoadingSupervisorDto {
  @IsUUID() userId!: string;
}

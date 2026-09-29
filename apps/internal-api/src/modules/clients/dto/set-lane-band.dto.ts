import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** `PUT /clients/:id/rate-card/:laneId/band` — paise, like every money field here. */
export class SetLaneBandDto {
  /** Floor: a transporter quote below this is refused at entry. */
  @IsInt() @Min(1) bidMinPaise!: number;

  /** Ceiling: a quote above this is kept and flagged; awarding it needs Leadership. */
  @IsInt() @Min(1) bidMaxPaise!: number;

  /**
   * Required only when a band already exists — changing one is a Leadership
   * decision and the approvals engine wants a reason of at least 20 characters.
   * Setting a lane's first band needs none.
   */
  @IsOptional() @IsString() reason?: string;
}

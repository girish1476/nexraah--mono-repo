import { IsObject, IsUUID, Matches } from 'class-validator';
import type { TargetMetric } from './target-rules';

export class SetTargetsDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
  @IsUUID() branchId!: string;

  /**
   * One entry per measure being changed: a whole number sets it (a count, or
   * paise), null takes the target away. Measures left out are not touched.
   * Checked value by value in the service, which answers with a sentence.
   */
  @IsObject() targets!: Partial<Record<TargetMetric, number | null>>;
}

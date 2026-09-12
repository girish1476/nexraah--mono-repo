import { IsInt, IsOptional, Min } from 'class-validator';

/** `docs/api/01-foundation.md` `PATCH /config/number-series/:key`. */
export class PatchNumberSeriesDto {
  @IsInt()
  @Min(1)
  nextValue!: number;

  /** Omit to keep the current width — the console only ever moves `nextValue`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;
}

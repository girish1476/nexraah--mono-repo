import { IsInt, Min } from 'class-validator';

/** `docs/api/01-foundation.md` `PATCH /config/number-series/:key`. */
export class PatchNumberSeriesDto {
  @IsInt()
  @Min(1)
  nextValue!: number;

  @IsInt()
  @Min(1)
  width!: number;
}

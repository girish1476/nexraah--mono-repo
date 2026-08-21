import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

/** `PATCH /trips/:id/lr` — draft autosave, every 3 seconds. Each provided key replaces that section wholesale. */
export class PatchLrDto {
  @IsOptional() @IsObject() consignor?: { name: string; address?: string; gstin?: string };
  @IsOptional() @IsObject() consignee?: { name: string; address?: string; gstin?: string };
  @IsOptional() @IsObject() goods?: { description?: string; packages?: number; weightTn?: number; valuePaise?: number };
  @IsOptional() @IsObject() invoice?: { number?: string; datedOn?: string; valuePaise?: number };
  @IsOptional() @IsObject() eway?: { number?: string; validTill?: string };
  @IsOptional() @IsObject() vehicle?: { registration?: string; type?: string };
  @IsOptional() @IsObject() driver?: { name?: string; licence?: string; phone?: string };
  @IsOptional() @IsInt() @Min(0) transitDays?: number;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional()
  @IsObject()
  chargeHeads?: {
    freightPaise?: number;
    loadingPaise?: number;
    unloadingPaise?: number;
    detentionPaise?: number;
    otherPaise?: number;
    discountPaise?: number;
  };
}

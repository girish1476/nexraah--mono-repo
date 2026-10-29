import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateNested } from 'class-validator';

class PushKeysDto {
  /** The browser's public key — base64url, 65 bytes uncompressed. */
  @IsString() @Matches(/^[A-Za-z0-9_-]{80,100}$/) p256dh!: string;
  /** The browser's auth secret — base64url, 16 bytes. */
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,32}$/) auth!: string;
}

/** What `PushManager.subscribe()` hands back, as `subscription.toJSON()` gives it. */
export class PushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_tld: true }) @MaxLength(1000) endpoint!: string;
  @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}

export class ForgetPushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_tld: true }) @MaxLength(1000) endpoint!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

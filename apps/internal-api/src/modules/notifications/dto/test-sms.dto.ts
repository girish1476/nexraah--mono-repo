import { IsIn, IsOptional, Matches } from 'class-validator';
import { EVENTS, type NotificationEvent } from '../notification-events';

/** `POST /notifications/sms/test` — one SMS to the administrator's own phone, to check the set-up. */
export class TestSmsDto {
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a 10-digit Indian mobile number.' })
  mobile!: string;

  /** Which notification's template to send. Payment advice when not given. */
  @IsOptional() @IsIn(EVENTS as unknown as string[]) event?: NotificationEvent;
}

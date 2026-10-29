import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ForgetPushSubscriptionDto, PushSubscriptionDto } from './dto/push-subscription.dto';
import { NotificationsService } from './notifications.service';
import { vapidFromEnv } from './web-push';

/**
 * Browser notifications for staff. Any signed-in member of staff may turn them
 * on for their own browser; nobody can turn them on for anyone else.
 */
@Controller('notifications')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The server's public push key — the browser needs it to subscribe. Null when push is not set up. */
  @Get('push-key')
  pushKey() {
    return { publicKey: vapidFromEnv()?.publicKey ?? null };
  }

  /** This browser says yes. A "Notifications are on" message is sent to it at once, so the person sees it work. */
  @Post('push-subscriptions')
  async subscribe(
    @Body() dto: PushSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const target = { endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth };
    await this.notifications.saveStaffBrowser(user.userId, target, userAgent?.slice(0, 300) ?? null);
    return { saved: true, confirmation: await this.notifications.confirmBrowser(target) };
  }

  /** This browser says no more. */
  @Delete('push-subscriptions')
  async unsubscribe(@Body() dto: ForgetPushSubscriptionDto, @CurrentUser() user: AuthenticatedUser) {
    await this.notifications.forgetStaffBrowser(user.userId, dto.endpoint);
    return { removed: true };
  }
}

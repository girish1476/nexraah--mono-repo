import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ForgetPushSubscriptionDto, PushSubscriptionDto } from './dto/push-subscription.dto';
import { NotificationsService } from './notifications.service';
import { vapidFromEnv } from './web-push';
import { TestSmsDto } from './dto/test-sms.dto';
import { smsGatewayFromEnv, smsTemplates } from './sms';
import { sampleSmsValues, smsSetup } from './sms-setup';

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

  /** Where the SMS set-up stands: gateway, missing settings, and which notifications have a template. */
  @Get('sms')
  @RequirePermission('config.manage')
  sms() {
    return smsSetup();
  }

  /**
   * One SMS to a number the administrator gives, through the configured
   * gateway and the template set for one notification — the real wording, with
   * sample values. What the gateway says comes back as it is, so a wrong key, a
   * template id the gateway does not know or an empty balance is read here
   * rather than discovered on a live payment.
   */
  @Post('sms/test')
  @RequirePermission('config.manage')
  async testSms(@Body() dto: TestSmsDto) {
    const event = dto.event ?? 'payment.released';
    const gateway = smsGatewayFromEnv();
    if (!gateway) {
      throw new DomainException(409, 'SMS_NOT_SET_UP', `SMS is not set up yet. Still to fill in: ${smsSetup().missing.join(', ')}.`);
    }
    const templateId = smsTemplates()[event];
    if (!templateId) throw new DomainException(409, 'SMS_NO_TEMPLATE', `No template id is set for ${event} in SMS_TEMPLATES.`);
    const values = sampleSmsValues(event);
    try {
      const sent = await gateway.send({ mobile: dto.mobile, templateId, values });
      return { sent: true, provider: gateway.name, event, templateId, values, providerRef: sent.providerRef };
    } catch (e) {
      throw new DomainException(502, 'SMS_GATEWAY_REFUSED', (e as Error).message, { provider: gateway.name, event, templateId, values });
    }
  }
}

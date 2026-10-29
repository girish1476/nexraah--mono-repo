import { Body, Controller, Delete, Get, Headers, Post, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { PortalRoute } from '../../common/decorators/portal-route.decorator';
import { PortalServiceGuard } from '../../common/guards/portal-service.guard';
import { PortalVendorGuard } from './portal-vendor.guard';
import { PortalWriteGuard } from './portal-write.guard';
import { PortalExceptionFilter } from './portal-exception.filter';
import { PortalWriteInterceptor } from './portal-write.interceptor';
import { CurrentVendor, PortalReadOnly } from './portal.decorators';
import type { PortalVendor } from './portal.types';
import { PortalPushRepository } from './portal-push.repository';
import { ForgetPushSubscriptionDto, PushSubscriptionDto } from '../notifications/dto/push-subscription.dto';
import { sendPush, vapidFromEnv } from '../notifications/web-push';

/**
 * Browser notifications on the transporter portal — most transporters use it
 * on a phone, where a notification is how they hear a load is theirs or a
 * payment has gone out. Turning them on is not a business write, so a
 * suspended transporter may still do it (`@PortalReadOnly`).
 */
@PortalRoute()
@Controller('portal')
@UseGuards(PortalServiceGuard, PortalVendorGuard, PortalWriteGuard)
@UseFilters(PortalExceptionFilter)
@UseInterceptors(PortalWriteInterceptor)
export class PortalPushController {
  constructor(private readonly push: PortalPushRepository) {}

  /** The server's public push key; null when push is not set up. */
  @Get('push-key')
  pushKey() {
    return { publicKey: vapidFromEnv()?.publicKey ?? null };
  }

  /** This phone or browser says yes; a "Notifications are on" message goes to it at once. */
  @Post('push-subscriptions')
  @PortalReadOnly()
  async subscribe(
    @CurrentVendor() vendor: PortalVendor,
    @Body() dto: PushSubscriptionDto,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const target = { endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth };
    await this.push.save(vendor.vendorId, target, userAgent?.slice(0, 300) ?? null);
    const keys = vapidFromEnv();
    if (!keys) return { saved: true, confirmation: { ok: false, message: 'Push is not set up on the server (VAPID keys).' } };
    try {
      const outcome = await sendPush(
        target,
        { title: 'Notifications are on', body: `${vendor.legalName} will now hear about awards, payments and POD deadlines here.`, url: '/dashboard' },
        keys,
      );
      return { saved: true, confirmation: outcome.ok ? { ok: true } : { ok: false, message: outcome.message } };
    } catch (e) {
      return { saved: true, confirmation: { ok: false, message: (e as Error).message } };
    }
  }

  /** This phone or browser says no more. */
  @Delete('push-subscriptions')
  @PortalReadOnly()
  async unsubscribe(@CurrentVendor() vendor: PortalVendor, @Body() dto: ForgetPushSubscriptionDto) {
    await this.push.forget(vendor.vendorId, dto.endpoint);
    return { removed: true };
  }
}

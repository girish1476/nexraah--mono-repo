import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TelematicsHmacGuard } from '../../common/guards/telematics-hmac.guard';
import { TelematicsService } from './telematics.service';
import { PingDto } from './dto/ping.dto';

/**
 * `POST /telematics/ping` — the provider's webhook, not called by the
 * portal. Separate controller (not a method on `TelematicsController`) so
 * the class-level `@UseGuards` never mixes a JWT-guarded route with an
 * HMAC-guarded one — this endpoint carries no JWT at all (docs/api/
 * 10-telematics-import.md).
 */
@Controller()
@UseGuards(TelematicsHmacGuard)
export class TelematicsPingController {
  constructor(private readonly telematicsService: TelematicsService) {}

  @Post('telematics/ping')
  @HttpCode(202)
  async ping(@Body() dto: PingDto, @Req() request: Request) {
    await this.telematicsService.ingestPing(dto, request.body);
    return { accepted: true };
  }
}

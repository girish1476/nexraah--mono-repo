import { Module } from '@nestjs/common';
import { PublicTrackingController, TrackingLinksController } from './tracking-links.controller';
import { TrackingLinksService } from './tracking-links.service';
import { RoutePointsService } from './route-points.service';

@Module({
  controllers: [TrackingLinksController, PublicTrackingController],
  providers: [TrackingLinksService, RoutePointsService],
})
export class TrackingLinksModule {}

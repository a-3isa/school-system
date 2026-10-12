import { Module } from '@nestjs/common';
import { ActivitiesController, ActivitiesService, ParentActivitiesController } from './activities';
import { ParentTripsController, TripsController, TripsService } from './trips';

@Module({
  controllers: [ActivitiesController, ParentActivitiesController, TripsController, ParentTripsController],
  providers: [ActivitiesService, TripsService],
  exports: [ActivitiesService, TripsService],
})
export class ActivitiesModule {}

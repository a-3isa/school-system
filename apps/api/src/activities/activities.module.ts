import { Module } from '@nestjs/common';
import { ActivitiesController, ActivitiesService, ParentActivitiesController } from './activities';
import { EventsController, EventsService, ParentCalendarController, ParentEventsController } from './events';
import { ParentTripsController, TripsController, TripsService } from './trips';

@Module({
  controllers: [ActivitiesController, ParentActivitiesController, TripsController, ParentTripsController, EventsController, ParentEventsController, ParentCalendarController],
  providers: [ActivitiesService, TripsService, EventsService],
  exports: [ActivitiesService, TripsService, EventsService],
})
export class ActivitiesModule {}

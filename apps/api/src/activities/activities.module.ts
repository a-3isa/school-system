import { Module } from '@nestjs/common';
import { ActivitiesController, ActivitiesService, ParentActivitiesController } from './activities';

@Module({
  controllers: [ActivitiesController, ParentActivitiesController],
  providers: [ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}

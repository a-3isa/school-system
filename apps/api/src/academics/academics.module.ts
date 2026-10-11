import { Module } from '@nestjs/common';
import { AcademicsAccess } from './access';
import { AssessmentsController, AssessmentsService } from './assessments';
import { BandsController, BandsService } from './bands';
import { ParentAcademicsController, ParentAcademicsService } from './parent-academics';
import { ReportCardsController, ReportCardsService } from './report-cards';
import { ScoreService } from './scores';

@Module({
  controllers: [AssessmentsController, BandsController, ReportCardsController, ParentAcademicsController],
  providers: [AcademicsAccess, ScoreService, AssessmentsService, BandsService, ReportCardsService, ParentAcademicsService],
})
export class AcademicsModule {}

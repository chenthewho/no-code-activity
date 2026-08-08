import { Module } from '@nestjs/common';
import { AnalyticsController, AnalyticsReportController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController, AnalyticsReportController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}

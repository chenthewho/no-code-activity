import { Body, Controller, Get, HttpException, HttpStatus, Ip, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PERMISSION } from '@nca/shared';
import { Public, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { markRaw } from '../../common/interceptors/transform.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { reportEventsSchema, type ReportEventsDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

/** C 端埋点上报：无鉴权、按 IP 限流 */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Post('events')
  @ApiOperation({ summary: '批量埋点上报（expose / click / convert）' })
  async report(
    @Body(new ZodValidationPipe(reportEventsSchema)) dto: ReportEventsDto,
    @Ip() ip?: string,
    @Req() req?: Request,
  ) {
    const ok = await this.analytics.allow(ip);
    if (!ok) throw new HttpException('上报过于频繁', HttpStatus.TOO_MANY_REQUESTS);
    await this.analytics.ingest(dto, ip, req?.headers?.['user-agent']);
    return markRaw({ ok: true });
  }
}

/** 运营报表：需要登录 + activity:view */
@ApiTags('analytics')
@Controller('analytics')
@UseGuards(PermissionsGuard)
export class AnalyticsReportController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('report')
  @ApiOperation({ summary: '活动埋点报表（PV/点击/转化 + Top 节点 + 趋势）' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  report(@Query('activityId') activityId: string, @Query('days') days?: string) {
    return this.analytics.report(activityId, Math.min(Number(days) || 7, 30));
  }
}

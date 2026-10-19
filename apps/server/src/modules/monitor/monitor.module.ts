import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  Ip,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PERMISSION } from '@nca/shared';
import { Public, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { markRaw } from '../../common/interceptors/transform.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AlertEvaluator } from './alert.evaluator';
import {
  alertRuleSchema,
  listAlertsSchema,
  overviewSchema,
  reportMonitorSchema,
  updateAlertRuleSchema,
  type AlertRuleDto,
  type ReportMonitorDto,
} from './monitor.dto';
import { MonitorService } from './monitor.service';

/** C 端健康上报：无鉴权、按 IP 限流，与埋点分开存——两者的读者、保留期、口径都不同 */
@ApiTags('monitor')
@Controller('monitor')
class MonitorReportController {
  constructor(private readonly monitor: MonitorService) {}

  @Public()
  @Post('events')
  @HttpCode(200)
  @ApiOperation({ summary: '渲染器健康上报（boot / 加载失败 / DSL 校验失败 / 白屏 / JS 错误）' })
  async report(
    @Body(new ZodValidationPipe(reportMonitorSchema)) dto: ReportMonitorDto,
    @Ip() ip?: string,
    @Req() req?: Request,
  ) {
    await this.monitor.ingest(dto, ip, req?.headers?.['user-agent']);
    return markRaw({ ok: true });
  }
}

@ApiTags('monitor')
@Controller('monitor')
@UseGuards(PermissionsGuard)
class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('overview')
  @ApiOperation({ summary: '监控看板：访问量、各项失败率、首屏耗时分位、趋势、问题活动、最近异常' })
  @RequirePermissions(PERMISSION.MONITOR_VIEW)
  overview(
    @Query(new ZodValidationPipe(overviewSchema)) query: { hours: number; activityId?: string },
  ) {
    return this.monitor.overview(query.hours, query.activityId);
  }

  @Get('alerts')
  @ApiOperation({ summary: '告警记录' })
  @RequirePermissions(PERMISSION.MONITOR_VIEW)
  alerts(
    @Query(new ZodValidationPipe(listAlertsSchema)) query: { page: number; pageSize: number },
  ) {
    return this.monitor.alerts(query.page, query.pageSize);
  }

  @Get('alert-rules')
  @ApiOperation({ summary: '告警规则列表' })
  @RequirePermissions(PERMISSION.MONITOR_VIEW)
  rules() {
    return this.monitor.rules();
  }

  @Post('alert-rules')
  @ApiOperation({ summary: '新建告警规则' })
  @RequirePermissions(PERMISSION.MONITOR_MANAGE)
  @Audit({ action: 'monitor.rule.create' })
  createRule(@Body(new ZodValidationPipe(alertRuleSchema)) dto: AlertRuleDto) {
    return this.monitor.createRule(dto);
  }

  @Patch('alert-rules/:id')
  @ApiOperation({ summary: '修改告警规则' })
  @RequirePermissions(PERMISSION.MONITOR_MANAGE)
  @Audit({ action: 'monitor.rule.update', targetParam: 'id' })
  updateRule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAlertRuleSchema)) dto: Partial<AlertRuleDto>,
  ) {
    return this.monitor.updateRule(id, dto);
  }

  @Delete('alert-rules/:id')
  @ApiOperation({ summary: '删除告警规则' })
  @RequirePermissions(PERMISSION.MONITOR_MANAGE)
  @Audit({ action: 'monitor.rule.remove', targetParam: 'id' })
  removeRule(@Param('id') id: string) {
    return this.monitor.removeRule(id);
  }

  @Post('alert-rules/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: '发送一条测试通知' })
  @RequirePermissions(PERMISSION.MONITOR_MANAGE)
  testRule(@Param('id') id: string) {
    return this.monitor.testRule(id);
  }
}

/** 运行监控与告警。MonitorService 全局可用：发布流程要往里记「发布校验失败」 */
@Global()
@Module({
  controllers: [MonitorReportController, MonitorController],
  providers: [MonitorService, AlertEvaluator],
  exports: [MonitorService],
})
export class MonitorModule {}

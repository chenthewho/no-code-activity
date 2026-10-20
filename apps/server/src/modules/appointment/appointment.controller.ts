import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@nca/shared';
import { RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActivityAccessGuard, RequireActivityAccess } from '../access/activity-access.guard';
import { Audit } from '../audit/audit.decorator';
import {
  createSceneSchema,
  updateSceneSchema,
  type CreateSceneDto,
  type UpdateSceneDto,
} from './appointment.dto';
import { AppointmentService } from './appointment.service';

/** 后台：预约场次配置。场次是活动内容的一部分，跟活动编辑同一个权限 */
@ApiTags('appointment')
@Controller('appointment-scenes')
@UseGuards(PermissionsGuard, ActivityAccessGuard)
export class AppointmentController {
  constructor(private readonly appointments: AppointmentService) {}

  @Get()
  @ApiOperation({ summary: '活动的预约场次（含已约人数）' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  @RequireActivityAccess('view', { query: 'activityId' })
  list(@Query('activityId') activityId: string) {
    return this.appointments.list(activityId);
  }

  @Post()
  @ApiOperation({ summary: '新建预约场次' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('edit', { body: 'activityId' })
  @Audit({ action: 'appointment_scene.create' })
  create(@Body(new ZodValidationPipe(createSceneSchema)) dto: CreateSceneDto) {
    return this.appointments.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改场次；名额不能少于已约人数' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('edit', { sceneParam: 'id' })
  @Audit({ action: 'appointment_scene.update', targetParam: 'id' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateSceneSchema)) dto: UpdateSceneDto) {
    return this.appointments.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除场次（已有人预约的不能删）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('edit', { sceneParam: 'id' })
  @Audit({ action: 'appointment_scene.remove', targetParam: 'id' })
  remove(@Param('id') id: string) {
    return this.appointments.remove(id);
  }
}

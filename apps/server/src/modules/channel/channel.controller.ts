import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@nca/shared';
import { RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActivityAccessGuard, RequireActivityAccess } from '../access/activity-access.guard';
import { Audit } from '../audit/audit.decorator';
import { createChannelSchema, type CreateChannelDto } from './channel.dto';
import { ChannelService } from './channel.service';

@ApiTags('channel')
@Controller('channels')
@UseGuards(PermissionsGuard, ActivityAccessGuard)
export class ChannelController {
  constructor(private readonly channels: ChannelService) {}

  @Get()
  @ApiOperation({ summary: '活动渠道列表（含生成的可跟踪链接）' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  @RequireActivityAccess('view', { query: 'activityId' })
  list(@Query('activityId') activityId: string) {
    return this.channels.list(activityId);
  }

  @Post()
  @ApiOperation({ summary: '新建渠道，返回落地链接' })
  @RequirePermissions(PERMISSION.CHANNEL_MANAGE)
  @RequireActivityAccess('edit', { body: 'activityId' })
  @Audit({ action: 'channel.create' })
  create(@Body(new ZodValidationPipe(createChannelSchema)) dto: CreateChannelDto) {
    return this.channels.create(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除渠道' })
  @RequirePermissions(PERMISSION.CHANNEL_MANAGE)
  @RequireActivityAccess('edit', { channelParam: 'id' })
  @Audit({ action: 'channel.remove', targetParam: 'id' })
  remove(@Param('id') id: string) {
    return this.channels.remove(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ACTIVITY_STATUS, PERMISSION } from '@nca/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DraftService } from '../dsl/draft.service';
import { PublishService } from '../publish/publish.service';
import type { JwtPayload } from '../auth/auth.types';
import {
  createActivitySchema,
  listActivitySchema,
  saveDraftSchema,
  updateActivitySchema,
  type CreateActivityDto,
  type ListActivityDto,
  type SaveDraftDto,
  type UpdateActivityDto,
} from './activity.dto';
import { ActivityService } from './activity.service';

const publishSchema = z.object({ changelog: z.string().max(500).optional() });
const rollbackSchema = z.object({ version: z.coerce.number().int().positive() });
const statusSchema = z.object({
  status: z.enum([ACTIVITY_STATUS.PUBLISHED, ACTIVITY_STATUS.OFFLINE]),
});

@ApiTags('activity')
@Controller('activities')
@UseGuards(PermissionsGuard)
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly draft: DraftService,
    private readonly publish: PublishService,
  ) {}

  @Get()
  @ApiOperation({ summary: '活动列表' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  list(@Query(new ZodValidationPipe(listActivitySchema)) query: ListActivityDto) {
    return this.activity.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '活动详情' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  detail(@Param('id') id: string) {
    return this.activity.detail(id);
  }

  @Post()
  @ApiOperation({ summary: '新建活动（可基于模板）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  create(
    @Body(new ZodValidationPipe(createActivitySchema)) dto: CreateActivityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activity.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新活动基础信息' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateActivitySchema)) dto: UpdateActivityDto,
  ) {
    return this.activity.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除活动（软删除）' })
  @RequirePermissions(PERMISSION.ACTIVITY_DELETE)
  remove(@Param('id') id: string) {
    return this.activity.remove(id);
  }

  @Post(':id/copy')
  @ApiOperation({ summary: '复制活动' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  copy(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.activity.copy(id, user.sub);
  }

  // ---- 设计器草稿 ----

  @Get(':id/draft')
  @ApiOperation({ summary: '读取设计器草稿 DSL' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  getDraft(@Param('id') id: string) {
    return this.draft.get(id);
  }

  @Put(':id/draft')
  @ApiOperation({ summary: '保存设计器草稿（自动保存）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  saveDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveDraftSchema)) dto: SaveDraftDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.draft.save(id, dto.dsl, user.sub);
  }

  // ---- 发布 ----

  @Post(':id/publish')
  @ApiOperation({ summary: '发布活动，生成不可变版本快照' })
  @RequirePermissions(PERMISSION.ACTIVITY_PUBLISH)
  publishActivity(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishSchema)) dto: { changelog?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.publish.publish(id, user.sub, dto.changelog);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: '发布版本列表' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  versions(@Param('id') id: string) {
    return this.publish.listVersions(id);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: '回滚到指定版本（只切指针，秒级生效）' })
  @RequirePermissions(PERMISSION.ACTIVITY_PUBLISH)
  rollback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rollbackSchema)) dto: { version: number },
  ) {
    return this.publish.rollback(id, dto.version);
  }

  @Post(':id/status')
  @ApiOperation({ summary: '上线 / 下线' })
  @RequirePermissions(PERMISSION.ACTIVITY_PUBLISH)
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) dto: { status: 'published' | 'offline' },
  ) {
    return this.publish.changeStatus(id, dto.status);
  }
}

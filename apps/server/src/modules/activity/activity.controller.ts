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
import { ActivityAccessGuard, RequireActivityAccess } from '../access/activity-access.guard';
import { Audit } from '../audit/audit.decorator';
import { DraftService } from '../dsl/draft.service';
import { PublishService } from '../publish/publish.service';
import type { JwtPayload } from '../auth/auth.types';
import {
  createActivitySchema,
  listActivitySchema,
  saveDraftSchema,
  transferOwnerSchema,
  updateActivitySchema,
  upsertMemberSchema,
  type CreateActivityDto,
  type ListActivityDto,
  type SaveDraftDto,
  type UpdateActivityDto,
  type UpsertMemberDto,
} from './activity.dto';
import { ActivityService } from './activity.service';

const publishSchema = z.object({ changelog: z.string().max(500).optional() });
const rollbackSchema = z.object({ version: z.coerce.number().int().positive() });
const statusSchema = z.object({
  status: z.enum([ACTIVITY_STATUS.PUBLISHED, ACTIVITY_STATUS.OFFLINE]),
});

/**
 * 两道闸：PermissionsGuard 管「能不能做这类事」（功能权限），
 * ActivityAccessGuard 管「能不能对这个活动做」（数据权限：负责人 / 协作成员 / activity:all）。
 */
@ApiTags('activity')
@Controller('activities')
@UseGuards(PermissionsGuard, ActivityAccessGuard)
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly draft: DraftService,
    private readonly publish: PublishService,
  ) {}

  @Get()
  @ApiOperation({ summary: '活动列表' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  list(
    @Query(new ZodValidationPipe(listActivitySchema)) query: ListActivityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activity.list(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: '活动详情（含当前用户的访问级别）' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  @RequireActivityAccess('view')
  detail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.activity.detailFor(id, user);
  }

  // ---- 协作成员 ----

  @Get(':id/members')
  @ApiOperation({ summary: '负责人与协作成员' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  @RequireActivityAccess('view')
  members(@Param('id') id: string) {
    return this.activity.members(id);
  }

  @Put(':id/members')
  @ApiOperation({ summary: '添加协作成员或修改其角色（负责人）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('manage')
  @Audit({ action: 'activity.member.upsert', targetParam: 'id' })
  upsertMember(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertMemberSchema)) dto: UpsertMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activity.upsertMember(id, dto, user.sub);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: '移除协作成员（负责人）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('manage')
  @Audit({ action: 'activity.member.remove', targetParam: 'id' })
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.activity.removeMember(id, userId);
  }

  @Post(':id/owner')
  @ApiOperation({ summary: '转交负责人（原负责人保留编辑权限）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('manage')
  @Audit({ action: 'activity.owner.transfer', targetParam: 'id' })
  transferOwner(@Param('id') id: string, @Body(new ZodValidationPipe(transferOwnerSchema)) dto: { userId: string }) {
    return this.activity.transferOwner(id, dto.userId);
  }

  @Post()
  @ApiOperation({ summary: '新建活动（可基于模板）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @Audit({ action: 'activity.create' })
  create(
    @Body(new ZodValidationPipe(createActivitySchema)) dto: CreateActivityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activity.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新活动基础信息' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('edit')
  @Audit({ action: 'activity.update', targetParam: 'id' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateActivitySchema)) dto: UpdateActivityDto,
  ) {
    return this.activity.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除活动（软删除，仅负责人）' })
  @RequirePermissions(PERMISSION.ACTIVITY_DELETE)
  @RequireActivityAccess('manage')
  @Audit({ action: 'activity.remove', targetParam: 'id' })
  remove(@Param('id') id: string) {
    return this.activity.remove(id);
  }

  @Post(':id/copy')
  @ApiOperation({ summary: '复制活动（副本归复制人负责）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('view')
  @Audit({ action: 'activity.copy', targetParam: 'id' })
  copy(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.activity.copy(id, user.sub);
  }

  // ---- 设计器草稿 ----

  @Get(':id/draft')
  @ApiOperation({ summary: '读取设计器草稿 DSL' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  @RequireActivityAccess('view')
  getDraft(@Param('id') id: string) {
    return this.draft.get(id);
  }

  @Put(':id/draft')
  @ApiOperation({ summary: '保存设计器草稿（自动保存）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @RequireActivityAccess('edit')
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
  @RequireActivityAccess('edit')
  @Audit({ action: 'activity.publish', targetParam: 'id' })
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
  @RequireActivityAccess('view')
  versions(@Param('id') id: string) {
    return this.publish.listVersions(id);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: '回滚到指定版本（只切指针，秒级生效）' })
  @RequirePermissions(PERMISSION.ACTIVITY_PUBLISH)
  @RequireActivityAccess('edit')
  @Audit({ action: 'activity.rollback', targetParam: 'id' })
  rollback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rollbackSchema)) dto: { version: number },
  ) {
    return this.publish.rollback(id, dto.version);
  }

  @Post(':id/status')
  @ApiOperation({ summary: '上线 / 下线' })
  @RequirePermissions(PERMISSION.ACTIVITY_PUBLISH)
  @RequireActivityAccess('edit')
  @Audit({ action: 'activity.status', targetParam: 'id' })
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) dto: { status: 'published' | 'offline' },
  ) {
    return this.publish.changeStatus(id, dto.status);
  }
}

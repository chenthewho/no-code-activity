import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@nca/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import type { JwtPayload } from '../auth/auth.types';
import {
  createRoleSchema,
  createUserSchema,
  listUserSchema,
  lookupUserSchema,
  resetPasswordSchema,
  updateRoleSchema,
  updateUserSchema,
  type CreateRoleDto,
  type CreateUserDto,
  type ListUserDto,
  type UpdateRoleDto,
  type UpdateUserDto,
} from './user.dto';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('users')
@UseGuards(PermissionsGuard)
class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  @ApiOperation({ summary: '用户列表' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  list(@Query(new ZodValidationPipe(listUserSchema)) query: ListUserDto) {
    return this.users.list(query);
  }

  /** 拉活动协作成员时用：能编辑活动的人就能搜，不需要 user:manage */
  @Get('lookup')
  @ApiOperation({ summary: '按用户名/昵称搜索用户（选协作成员）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  lookup(@Query(new ZodValidationPipe(lookupUserSchema)) query: { keyword: string }) {
    return this.users.lookup(query.keyword);
  }

  @Post()
  @ApiOperation({ summary: '新建用户' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  @Audit({ action: 'user.create' })
  create(
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.users.create(dto, actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改用户（昵称、启停、角色）' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  @Audit({ action: 'user.update', targetParam: 'id' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.users.update(id, dto, actor);
  }

  @Post(':id/password')
  @HttpCode(200)
  @ApiOperation({ summary: '重置密码' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  @Audit({ action: 'user.resetPassword', targetParam: 'id' })
  resetPassword(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: { password: string },
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.users.resetPassword(id, dto.password, actor);
  }
}

@ApiTags('user')
@Controller()
@UseGuards(PermissionsGuard)
class RoleController {
  constructor(private readonly users: UserService) {}

  @Get('roles')
  @ApiOperation({ summary: '角色列表（含权限码与使用人数）' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  roles() {
    return this.users.roles();
  }

  @Get('permissions')
  @ApiOperation({ summary: '全部权限码' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  permissions() {
    return this.users.permissions();
  }

  @Post('roles')
  @ApiOperation({ summary: '新建角色' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  @Audit({ action: 'role.create' })
  createRole(
    @Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.users.createRole(dto, actor);
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: '修改角色与授权' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  @Audit({ action: 'role.update', targetParam: 'id' })
  updateRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.users.updateRole(id, dto, actor);
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: '删除角色（仍有人使用时拒绝）' })
  @RequirePermissions(PERMISSION.USER_MANAGE)
  @Audit({ action: 'role.remove', targetParam: 'id' })
  removeRole(@Param('id') id: string) {
    return this.users.removeRole(id);
  }
}

@Module({
  controllers: [UserController, RoleController],
  providers: [UserService],
})
export class UserModule {}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@nca/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.types';
import {
  completeUploadSchema,
  listSchema,
  registerSchema,
  uploadTicketSchema,
  type CompleteUploadDto,
  type ListDto,
  type RegisterDto,
  type UploadTicketDto,
} from './asset.dto';
import { AssetService, MAX_PROXY_BYTES, type UploadedFileLike } from './asset.service';

@ApiTags('asset')
@Controller('assets')
@UseGuards(PermissionsGuard)
class AssetController {
  constructor(private readonly service: AssetService) {}

  @Get()
  @ApiOperation({ summary: '资源列表（素材库）' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  list(@Query(new ZodValidationPipe(listSchema)) query: ListDto) {
    return this.service.list(query);
  }

  @Post('upload-ticket')
  @HttpCode(200)
  @ApiOperation({ summary: '直传第一步：去重 + 签发 STS 临时凭证（未配 COS 时指示走中转）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  ticket(
    @Body(new ZodValidationPipe(uploadTicketSchema)) dto: UploadTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createUploadTicket(dto, user.sub);
  }

  @Post('upload-complete')
  @HttpCode(200)
  @ApiOperation({ summary: '直传第二步：确认对象已到桶里，登记为素材' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  complete(
    @Body(new ZodValidationPipe(completeUploadSchema)) dto: CompleteUploadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.completeUpload(dto, user.sub);
  }

  @Post('upload')
  @ApiOperation({ summary: '服务端中转上传（未配 COS 时使用）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROXY_BYTES } }))
  upload(
    @UploadedFile() file: UploadedFileLike,
    @CurrentUser() user: JwtPayload,
    @Body('activityId') activityId?: string,
  ) {
    return this.service.upload(file, user.sub, activityId);
  }

  @Post('register')
  @ApiOperation({ summary: '登记外部资源地址' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.register(dto, user.sub);
  }
}

@Module({
  controllers: [AssetController],
  providers: [AssetService],
})
export class AssetModule {}

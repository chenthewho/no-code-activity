import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type PageResult } from '@nca/shared';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { JwtPayload } from '../auth/auth.types';

/** 与图片相关的白名单。视频/字体等按需再放开 */
const ALLOWED_MIME = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['video/mp4', '.mp4'],
]);

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * 只声明实际用到的字段，而不依赖 @types/multer 的全局 Express 命名空间扩展——
 * 该扩展在 multer 类型包大版本间反复变动，绑上去等于给自己埋升级坑。
 */
interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
  activityId: z.string().optional(),
  type: z.string().optional(),
});
type ListDto = z.infer<typeof listSchema>;

const registerSchema = z.object({
  url: z.string().min(1),
  type: z.enum(['image', 'video', 'audio', 'font']),
  activityId: z.string().optional(),
  size: z.number().int().nonnegative().default(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
type RegisterDto = z.infer<typeof registerSchema>;

interface AssetItem {
  id: string;
  url: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
}

@Injectable()
class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListDto): Promise<PageResult<AssetItem>> {
    const where = {
      ...(query.activityId ? { activityId: query.activityId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.asset.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        url: row.url,
        type: row.type,
        size: row.size,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 服务端中转上传。
   *
   * COS 就绪后应换成 STS 临时密钥前端直传，服务端只负责签名与登记——
   * 中转会让大文件把带宽和内存都压在应用服务器上。接口形状特意
   * 保持一致（都返回 { url }），届时前端不用改。
   */
  async upload(file: UploadedFileLike, userId: string, activityId?: string) {
    if (!file) throw new BadRequestException('请选择文件');
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`文件超过 ${MAX_BYTES / 1024 / 1024}MB 上限`);
    }

    const ext = ALLOWED_MIME.get(file.mimetype);
    if (!ext) {
      throw new BadRequestException(`不支持的文件类型：${file.mimetype}`);
    }

    // 内容寻址：同一张图重复上传不会产生副本，也天然可长缓存
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.asset.findFirst({ where: { hash } });
    if (existing) {
      return { url: existing.url, id: existing.id, reused: true };
    }

    const safeExt = ALLOWED_MIME.get(file.mimetype) ?? extname(file.originalname);
    const key = `assets/${hash.slice(0, 2)}/${hash}${safeExt}`;
    const { url } = await this.storage.putBuffer(key, file.buffer, file.mimetype);

    const asset = await this.prisma.asset.create({
      data: {
        url,
        type: file.mimetype.startsWith('video') ? 'video' : 'image',
        size: file.size,
        hash,
        activityId: activityId ?? null,
        uploadedBy: userId,
      },
    });

    return { url, id: asset.id, reused: false };
  }

  async register(dto: RegisterDto, userId: string) {
    return this.prisma.asset.create({
      data: {
        url: dto.url,
        type: dto.type,
        size: dto.size,
        width: dto.width,
        height: dto.height,
        activityId: dto.activityId ?? null,
        uploadedBy: userId,
      },
    });
  }
}

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

  @Post('upload')
  @ApiOperation({ summary: '上传资源' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  upload(
    @UploadedFile() file: UploadedFileLike,
    @CurrentUser() user: JwtPayload,
    @Body('activityId') activityId?: string,
  ) {
    return this.service.upload(file, user.sub, activityId);
  }

  @Post('register')
  @ApiOperation({ summary: '登记外部资源地址（直传后回调）' })
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
  providers: [AssetService, StorageService],
})
export class AssetModule {}

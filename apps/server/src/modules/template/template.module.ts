import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { finalDslSchema } from '@nca/dsl';
import { PERMISSION, type PageResult } from '@nca/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActivityAccessGuard, RequireActivityAccess } from '../access/activity-access.guard';
import { Audit } from '../audit/audit.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.types';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  keyword: z.string().optional(),
  /** 只看我收藏的 */
  onlyFavorite: z.coerce.boolean().optional(),
});
type ListDto = z.infer<typeof listSchema>;

const createSchema = z.object({
  title: z.string().min(1).max(120),
  cover: z.string().optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(40).optional(),
  /** 从某个活动的草稿另存为模板 */
  activityId: z.string().min(1),
});
type CreateDto = z.infer<typeof createSchema>;

interface TemplateSummary {
  id: string;
  title: string;
  cover?: string;
  description?: string;
  category?: string;
  useCount: number;
  favCount: number;
  favorited: boolean;
  createdAt: string;
}

@Injectable()
class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListDto, userId: string): Promise<PageResult<TemplateSummary>> {
    const where: Prisma.TemplateWhereInput = {
      enabled: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
      ...(query.onlyFavorite ? { favorites: { some: { userId } } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.template.findMany({
        where,
        orderBy: [{ useCount: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        // 只取当前用户那条收藏记录，用来判断本人是否已收藏
        include: { favorites: { where: { userId }, select: { userId: true } } },
      }),
      this.prisma.template.count({ where }),
    ]);

    return {
      list: rows.map((row) => ({
        id: row.id,
        title: row.title,
        cover: row.cover ?? undefined,
        description: row.description ?? undefined,
        category: row.category ?? undefined,
        useCount: row.useCount,
        favCount: row.favCount,
        favorited: row.favorites.length > 0,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 已有模板用过的分类，供筛选下拉直接列出，不必另建字典表 */
  async categories(): Promise<string[]> {
    const rows = await this.prisma.template.findMany({
      where: { enabled: true, category: { not: null } },
      distinct: ['category'],
      select: { category: true },
    });
    return rows.map((r) => r.category).filter((c): c is string => Boolean(c));
  }

  async detail(id: string) {
    const template = await this.prisma.template.findUnique({ where: { id } });
    if (!template || !template.enabled) throw new NotFoundException('模板不存在');
    return template;
  }

  /** 另存为模板：复制当前草稿，并抹掉活动专属的 meta，避免带着旧活动 id 到处传播 */
  async createFromActivity(dto: CreateDto, userId: string) {
    const draft = await this.prisma.dslDraft.findUnique({ where: { activityId: dto.activityId } });
    if (!draft) throw new NotFoundException('活动草稿不存在');

    const parsed = finalDslSchema.safeParse(draft.dsl);
    if (!parsed.success) throw new BadRequestException('草稿内容不合法，无法另存为模板');

    const dsl = {
      ...parsed.data,
      meta: {
        ...parsed.data.meta,
        activityId: 'template',
        title: dto.title,
        startTime: undefined,
        endTime: undefined,
      },
    };

    return this.prisma.template.create({
      data: {
        title: dto.title,
        cover: dto.cover,
        description: dto.description,
        category: dto.category,
        dsl: dsl as unknown as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });
  }

  /**
   * 收藏开关。favCount 与收藏记录必须在同一事务里增减，
   * 否则并发下计数会和实际收藏数对不上。
   */
  async toggleFavorite(templateId: string, userId: string): Promise<{ favorited: boolean }> {
    await this.detail(templateId);
    const existing = await this.prisma.templateFavorite.findUnique({
      where: { userId_templateId: { userId, templateId } },
    });

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.templateFavorite.delete({
          where: { userId_templateId: { userId, templateId } },
        }),
        this.prisma.template.update({
          where: { id: templateId },
          data: { favCount: { decrement: 1 } },
        }),
      ]);
      return { favorited: false };
    }

    await this.prisma.$transaction([
      this.prisma.templateFavorite.create({ data: { userId, templateId } }),
      this.prisma.template.update({
        where: { id: templateId },
        data: { favCount: { increment: 1 } },
      }),
    ]);
    return { favorited: true };
  }

  /** 下架而非物理删除：已用该模板创建的活动仍需追溯来源 */
  async disable(id: string) {
    await this.detail(id);
    await this.prisma.template.update({ where: { id }, data: { enabled: false } });
  }
}

@ApiTags('template')
@Controller('templates')
@UseGuards(PermissionsGuard, ActivityAccessGuard)
class TemplateController {
  constructor(private readonly service: TemplateService) {}

  @Get()
  @ApiOperation({ summary: '模板列表' })
  @RequirePermissions(PERMISSION.TEMPLATE_VIEW)
  list(
    @Query(new ZodValidationPipe(listSchema)) query: ListDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.list(query, user.sub);
  }

  @Get('categories')
  @ApiOperation({ summary: '模板分类列表' })
  @RequirePermissions(PERMISSION.TEMPLATE_VIEW)
  categories() {
    return this.service.categories();
  }

  @Get(':id')
  @ApiOperation({ summary: '模板详情（含 DSL，用于预览）' })
  @RequirePermissions(PERMISSION.TEMPLATE_VIEW)
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post()
  @ApiOperation({ summary: '将活动另存为模板' })
  @RequirePermissions(PERMISSION.TEMPLATE_MANAGE)
  @RequireActivityAccess('view', { body: 'activityId' })
  @Audit({ action: 'template.create' })
  create(
    @Body(new ZodValidationPipe(createSchema)) dto: CreateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createFromActivity(dto, user.sub);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: '收藏 / 取消收藏' })
  @RequirePermissions(PERMISSION.TEMPLATE_VIEW)
  @Audit({ action: 'template.favorite', targetParam: 'id' })
  favorite(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.toggleFavorite(id, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: '下架模板' })
  @RequirePermissions(PERMISSION.TEMPLATE_MANAGE)
  @Audit({ action: 'template.disable', targetParam: 'id' })
  disable(@Param('id') id: string) {
    return this.service.disable(id);
  }
}

@Module({
  controllers: [TemplateController],
  providers: [TemplateService],
})
export class TemplateModule {}

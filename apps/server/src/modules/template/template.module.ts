import {
  BadRequestException,
  Body,
  Controller,
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
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.types';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  keyword: z.string().optional(),
});
type ListDto = z.infer<typeof listSchema>;

const createSchema = z.object({
  title: z.string().min(1).max(120),
  cover: z.string().optional(),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
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
  createdAt: string;
}

@Injectable()
class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListDto): Promise<PageResult<TemplateSummary>> {
    const where: Prisma.TemplateWhereInput = {
      enabled: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.template.findMany({
        where,
        orderBy: { useCount: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
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
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
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
}

@ApiTags('template')
@Controller('templates')
@UseGuards(PermissionsGuard)
class TemplateController {
  constructor(private readonly service: TemplateService) {}

  @Get()
  @ApiOperation({ summary: '模板列表' })
  @RequirePermissions(PERMISSION.TEMPLATE_VIEW)
  list(@Query(new ZodValidationPipe(listSchema)) query: ListDto) {
    return this.service.list(query);
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
  create(
    @Body(new ZodValidationPipe(createSchema)) dto: CreateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createFromActivity(dto, user.sub);
  }
}

@Module({
  controllers: [TemplateController],
  providers: [TemplateService],
})
export class TemplateModule {}

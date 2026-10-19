import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { materialMetaSchema } from '@nca/dsl';
import { PERMISSION } from '@nca/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Audit } from '../audit/audit.decorator';

const toggleSchema = z.object({ enabled: z.boolean() });

export interface MaterialRegistryItem {
  name: string;
  title: string;
  version: string;
  category: string;
  enabled: boolean;
  deprecated?: { reason?: string; replacedBy?: string };
  updatedAt: string;
  usage: {
    /** 草稿里用到它的活动数 */
    activities: number;
    nodes: number;
    /** 记录的版本与注册表不一致的节点：下次打开设计器或渲染时会被升级 */
    outdated: number;
  };
}

@Injectable()
class MaterialService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 注册表 + 用量。用量直接在 MySQL 里用 JSON_TABLE 展开草稿节点树统计——
   * 把所有草稿捞回应用层逐个解析，活动一多就是几十 MB 的传输。
   */
  async registry(): Promise<MaterialRegistryItem[]> {
    const [rows, usage] = await Promise.all([
      this.prisma.material.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }] }),
      this.prisma.$queryRaw<
        { name: string; activities: bigint; nodes: bigint; outdated: bigint | null }[]
      >`
        SELECT jt.name AS name,
               COUNT(DISTINCT d.activityId) AS activities,
               COUNT(*) AS nodes,
               SUM(CASE WHEN COALESCE(jt.ver, '1.0.0') <> m.version THEN 1 ELSE 0 END) AS outdated
        FROM dsl_draft d
        JOIN activity a ON a.id = d.activityId AND a.deletedAt IS NULL
        CROSS JOIN JSON_TABLE(JSON_EXTRACT(d.dsl, '$.craftJson.*'), '$[*]' COLUMNS (
          name VARCHAR(64) COLLATE utf8mb4_unicode_ci PATH '$.type.resolvedName',
          ver VARCHAR(32) COLLATE utf8mb4_unicode_ci PATH '$.type.version'
        )) jt
        LEFT JOIN material m ON m.name = jt.name
        GROUP BY jt.name`,
    ]);
    const byName = new Map(usage.map((u) => [u.name, u]));
    return rows.map((row) => {
      const meta = materialMetaSchema.safeParse(row.meta);
      const used = byName.get(row.name);
      return {
        name: row.name,
        title: row.title,
        version: row.version,
        category: row.category,
        enabled: row.enabled,
        deprecated: meta.success ? meta.data.deprecated : undefined,
        updatedAt: row.updatedAt.toISOString(),
        usage: {
          activities: Number(used?.activities ?? 0),
          nodes: Number(used?.nodes ?? 0),
          outdated: Number(used?.outdated ?? 0),
        },
      };
    });
  }

  async toggle(name: string, enabled: boolean): Promise<void> {
    const existing = await this.prisma.material.findUnique({ where: { name } });
    if (!existing) throw new NotFoundException('物料不存在');
    await this.prisma.material.update({ where: { name }, data: { enabled } });
  }
}

/**
 * 物料注册表接口：设计器工具箱的数据来源。
 * 代码里的 @nca/materials 是实现，这张表管「哪些物料对运营可见」，
 * 便于灰度上线新物料、临时下架有问题的物料，而不用发版。
 */
@ApiTags('material')
@Controller('materials')
@UseGuards(PermissionsGuard)
class MaterialController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly service: MaterialService,
  ) {}

  @Get()
  @ApiOperation({ summary: '可用物料列表（含 propsSchema）' })
  async list(@Query('category') category?: string) {
    const rows = await this.prisma.material.findMany({
      where: { enabled: true, ...(category ? { category } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => row.meta);
  }

  @Get('registry')
  @ApiOperation({ summary: '物料注册表（含停用的）与草稿中的用量、待升级节点数' })
  @RequirePermissions(PERMISSION.MATERIAL_MANAGE)
  registry() {
    return this.service.registry();
  }

  @Patch(':name')
  @ApiOperation({ summary: '上架 / 下架物料（下架后工具箱不可见，使用它的活动无法再发布）' })
  @RequirePermissions(PERMISSION.MATERIAL_MANAGE)
  @Audit({ action: 'material.toggle', targetParam: 'name' })
  toggle(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(toggleSchema)) dto: { enabled: boolean },
  ) {
    return this.service.toggle(name, dto.enabled);
  }
}

@Module({ controllers: [MaterialController], providers: [MaterialService] })
export class MaterialModule {}

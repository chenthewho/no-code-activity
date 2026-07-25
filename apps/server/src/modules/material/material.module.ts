import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 物料注册表接口：设计器工具箱的数据来源。
 * 代码里的 @nca/materials 是实现，这张表管「哪些物料对运营可见」，
 * 便于灰度上线新物料、临时下架有问题的物料，而不用发版。
 */
@ApiTags('material')
@Controller('materials')
class MaterialController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '可用物料列表（含 propsSchema）' })
  async list(@Query('category') category?: string) {
    const rows = await this.prisma.material.findMany({
      where: { enabled: true, ...(category ? { category } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => row.meta);
  }
}

@Module({ controllers: [MaterialController] })
export class MaterialModule {}

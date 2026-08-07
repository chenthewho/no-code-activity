import { Body, Controller, Get, Injectable, Ip, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { finalDslSchema, manifestSchema, type FinalDsl, type Manifest } from '@nca/dsl';
import { ACTIVITY_STATUS } from '@nca/shared';
import { Public } from '../../common/decorators';
import { markRaw } from '../../common/interceptors/transform.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { drawSchema, type DrawDto } from '../prize/prize.dto';
import { PrizeModule } from '../prize/prize.module';
import { PrizeService } from '../prize/prize.service';

/** C 端表单提交：data 是任意字段表，运营在 Form 物料里配置 */
const submitFormSchema = z.object({
  activityId: z.string().min(1),
  formNodeId: z.string().min(1),
  userId: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});
type SubmitFormDto = z.infer<typeof submitFormSchema>;

/** C 端活动预约：一人一场次只能约一次（表上 @@unique 兜底并发） */
const appointmentSchema = z.object({
  activityId: z.string().min(1),
  sceneId: z.string().min(1),
  userId: z.string().min(1),
  contact: z.string().max(60).optional(),
});
type AppointmentDto = z.infer<typeof appointmentSchema>;

/**
 * C 端运行时接口。
 *
 * 生产环境 Renderer 应直接读 CDN 上的 manifest / DSL，这里的接口是
 * 本地开发与预览态的回源通道，同时兜住「CDN 还没刷新」的窗口期。
 */
@Injectable()
class RuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async currentVersion(activityId: string) {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { status: true, publishedVersion: true },
    });
    if (!activity) throw new NotFoundException('活动不存在');
    if (activity.status !== ACTIVITY_STATUS.PUBLISHED || !activity.publishedVersion) {
      throw new NotFoundException('活动未发布或已下线');
    }

    const version = await this.prisma.activityVersion.findUnique({
      where: {
        activityId_version: { activityId, version: activity.publishedVersion },
      },
    });
    if (!version) throw new NotFoundException('发布版本数据缺失');
    return version;
  }

  async manifest(activityId: string): Promise<Manifest> {
    const version = await this.currentVersion(activityId);
    if (!version.manifestUrl) throw new NotFoundException('该版本缺少 manifest');
    // manifest 存的是 URL，这里按存量数据重建一份等价结构，避免多一跳网络请求
    const dsl = finalDslSchema.parse(version.dsl);
    const entryJs = this.config.get('RENDERER_ENTRY_JS', { infer: true }) ?? '';
    const entryCss = this.config.get('RENDERER_ENTRY_CSS', { infer: true }) ?? '';
    return manifestSchema.parse({
      activityId,
      version: version.version,
      publishedAt: version.createdAt.toISOString(),
      // 入口脚本/样式来自配置（写进 manifest 的同一份），不要硬编码空串
      entry: { js: entryJs ? [entryJs] : [''], css: entryCss ? [entryCss] : [] },
      dsl: version.dslUrl ?? '',
      runtime: { schemaVersion: dsl.schemaVersion, hosts: dsl.meta.hosts },
    });
  }

  async dsl(activityId: string): Promise<FinalDsl> {
    const version = await this.currentVersion(activityId);
    return finalDslSchema.parse(version.dsl);
  }

  /** 表单提交：原样落 FormSubmission，userId 有则记（SSO 前是访客 id） */
  async submitForm(dto: SubmitFormDto, ip?: string) {
    return this.prisma.formSubmission.create({
      data: {
        activityId: dto.activityId,
        formNodeId: dto.formNodeId,
        userId: dto.userId ?? null,
        data: dto.data as Prisma.InputJsonValue,
        ip: ip ?? null,
      },
    });
  }

  /** 活动预约：一人一场次一次。并发下唯一约束兜底，重复预约返回 already */
  async bookAppointment(dto: AppointmentDto) {
    const where = {
      activityId_sceneId_userId: {
        activityId: dto.activityId,
        sceneId: dto.sceneId,
        userId: dto.userId,
      },
    };
    const existing = await this.prisma.appointmentRecord.findUnique({ where });
    if (existing) return { booked: true, already: true };
    try {
      await this.prisma.appointmentRecord.create({
        data: {
          activityId: dto.activityId,
          sceneId: dto.sceneId,
          userId: dto.userId,
          contact: dto.contact ?? null,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return { booked: true, already: true };
      throw err;
    }
    return { booked: true, already: false };
  }
}

@ApiTags('runtime')
@Controller('runtime/activities')
class RuntimeController {
  constructor(
    private readonly service: RuntimeService,
    private readonly prizeService: PrizeService,
  ) {}

  @Public()
  @Get(':id/dsl')
  @ApiOperation({ summary: '取当前线上版本的 DSL（C 端回源）' })
  async dsl(@Param('id') id: string) {
    // 不包 { code, message, data }：Renderer 与直读 CDN 走同一条解析路径
    return markRaw(await this.service.dsl(id));
  }

  @Public()
  @Get(':id/manifest')
  @ApiOperation({ summary: '取当前线上版本的 manifest' })
  async manifest(@Param('id') id: string) {
    return markRaw(await this.service.manifest(id));
  }

  @Public()
  @Get(':id/prizes')
  @ApiOperation({ summary: '活动奖品列表（公开字段，供 ds_prizes 数据源）' })
  async prizes(@Param('id') id: string) {
    return markRaw(await this.prizeService.publicList(id));
  }
}

/** C 端抽奖。独立于 activities 前缀，路径与开发计划中的 /runtime/lottery/draw 对齐 */
@ApiTags('runtime')
@Controller('runtime/lottery')
class RuntimeLotteryController {
  constructor(private readonly prizes: PrizeService) {}

  @Public()
  @Post('draw')
  @ApiOperation({ summary: '抽奖：按概率选奖 + 原子扣减库存 + 落中奖记录' })
  async draw(@Body(new ZodValidationPipe(drawSchema)) dto: DrawDto) {
    return markRaw(await this.prizes.draw(dto.activityId, dto.userId));
  }
}

/** C 端写操作：表单提交 / 活动预约 */
@ApiTags('runtime')
@Controller('runtime')
class RuntimeMutationController {
  constructor(private readonly service: RuntimeService) {}

  @Public()
  @Post('forms')
  @ApiOperation({ summary: '表单提交：写入 FormSubmission' })
  async submit(@Body(new ZodValidationPipe(submitFormSchema)) dto: SubmitFormDto, @Ip() ip?: string) {
    return markRaw(await this.service.submitForm(dto, ip));
  }

  @Public()
  @Post('appointment')
  @ApiOperation({ summary: '活动预约：一人一场次一次，重复预约返回 already' })
  async book(@Body(new ZodValidationPipe(appointmentSchema)) dto: AppointmentDto) {
    return markRaw(await this.service.bookAppointment(dto));
  }
}

@Module({
  imports: [PrizeModule],
  controllers: [RuntimeController, RuntimeLotteryController, RuntimeMutationController],
  providers: [RuntimeService],
})
export class RuntimeModule {}

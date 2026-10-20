import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Ip,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authConfigSchema, finalDslSchema, manifestSchema, type FinalDsl, type Manifest } from '@nca/dsl';
import { ACTIVITY_STATUS, matchGray, type GrayRule, type GrayVisitor } from '@nca/shared';
import { Public } from '../../common/decorators';
import { markRaw } from '../../common/interceptors/transform.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { drawSchema, type DrawDto } from '../prize/prize.dto';
import { PrizeModule } from '../prize/prize.module';
import { PrizeService } from '../prize/prize.service';
import { RuntimeAuthModule } from '../runtime-auth/runtime-auth.module';
import type { RuntimeTokenPayload } from '../runtime-auth/runtime-auth.service';
import { RuntimeUser, RuntimeUserGuard } from '../runtime-auth/runtime-user.guard';

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
  /** 访客标识，仅活动不要求登录时使用；登录用户以 token 为准 */
  userId: z.string().min(1).max(128).optional(),
  contact: z.string().max(60).optional(),
});
type AppointmentDto = z.infer<typeof appointmentSchema>;

/**
 * C 端运行时接口。
 *
 * 生产环境 Renderer 应直接读 CDN 上的 manifest / DSL，这里的接口是
 * 本地开发与预览态的回源通道，同时兜住「CDN 还没刷新」的窗口期。
 */
/** 活动登录策略缓存时长：发布/回滚后最多这么久生效，换来每次抽奖少一次查库 */
const AUTH_POLICY_TTL_MS = 30_000;

@Injectable()
export class RuntimeService {
  private readonly authPolicies = new Map<string, { loginRequired: boolean; expireAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 确定「这次参与算谁的」。
   *
   * 登录用户一律以 C 端 token 为准，body 里自报的 userId 直接忽略；
   * 活动配置了登录方式（meta.auth.loginMode ≠ none 或 required）时不接受访客，
   * 否则 limitPerUser 之类的按人限制换个 userId 就能绕过去。
   */
  async resolveParticipant(
    activityId: string,
    runtimeUser: RuntimeTokenPayload | null,
    guestId: string | undefined,
  ): Promise<string> {
    if (runtimeUser) return runtimeUser.sub;
    if (await this.loginRequired(activityId)) {
      throw new UnauthorizedException({ message: '请先登录', reason: 'LOGIN_REQUIRED' });
    }
    if (!guestId) throw new BadRequestException('缺少用户标识');
    return guestId;
  }

  private async loginRequired(activityId: string): Promise<boolean> {
    const cached = this.authPolicies.get(activityId);
    if (cached && cached.expireAt > Date.now()) return cached.loginRequired;

    // 灰度期间新旧两版可能登录要求不同，取更严的那个：
    // 放过访客的那一版不能成为绕过登录限次的口子
    const activity = await this.onlineActivity(activityId);
    const versions = [activity.publishedVersion!, ...(activity.grayVersion ? [activity.grayVersion] : [])];
    let loginRequired = false;
    for (const v of versions) {
      const row = await this.loadVersion(activityId, v);
      const meta = (row.dsl as { meta?: { auth?: unknown } }).meta;
      const auth = authConfigSchema.parse(meta?.auth ?? {});
      loginRequired ||= auth.required || auth.loginMode !== 'none';
    }
    this.authPolicies.set(activityId, { loginRequired, expireAt: Date.now() + AUTH_POLICY_TTL_MS });
    return loginRequired;
  }

  private async onlineActivity(activityId: string) {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { status: true, publishedVersion: true, grayVersion: true, grayRule: true },
    });
    if (!activity) throw new NotFoundException('活动不存在');
    if (activity.status !== ACTIVITY_STATUS.PUBLISHED || !activity.publishedVersion) {
      throw new NotFoundException('活动未发布或已下线');
    }
    return activity;
  }

  private async loadVersion(activityId: string, version: number) {
    const row = await this.prisma.activityVersion.findUnique({
      where: { activityId_version: { activityId, version } },
    });
    if (!row) throw new NotFoundException('发布版本数据缺失');
    return row;
  }

  /**
   * 这位访客该看哪个版本：灰度进行中且命中规则看灰度版，否则看全量版。
   * 不带访客信息（如服务端内部取策略）一律按全量版。
   */
  private async currentVersion(activityId: string, visitor?: GrayVisitor) {
    const activity = await this.onlineActivity(activityId);
    const gray =
      Boolean(visitor && activity.grayVersion && activity.grayRule) &&
      matchGray(activity.grayRule as unknown as GrayRule, visitor!);
    const version = await this.loadVersion(activityId, gray ? activity.grayVersion! : activity.publishedVersion!);
    return Object.assign(version, { gray });
  }

  async manifest(activityId: string, visitor?: GrayVisitor): Promise<Manifest> {
    const version = await this.currentVersion(activityId, visitor);
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

  async dsl(activityId: string, visitor?: GrayVisitor): Promise<{ dsl: FinalDsl; version: number; gray: boolean }> {
    const row = await this.currentVersion(activityId, visitor);
    return { dsl: finalDslSchema.parse(row.dsl), version: row.version, gray: row.gray };
  }

  /** 表单提交：原样落 FormSubmission。userId 为登录用户或访客 id */
  async submitForm(dto: SubmitFormDto, userId: string, ip?: string) {
    return this.prisma.formSubmission.create({
      data: {
        activityId: dto.activityId,
        formNodeId: dto.formNodeId,
        userId,
        data: dto.data as Prisma.InputJsonValue,
        ip: ip ?? null,
      },
    });
  }

  /** 活动预约：一人一场次一次。并发下唯一约束兜底，重复预约返回 already */
  async bookAppointment(dto: AppointmentDto, userId: string) {
    const where = {
      activityId_sceneId_userId: {
        activityId: dto.activityId,
        sceneId: dto.sceneId,
        userId,
      },
    };
    const existing = await this.prisma.appointmentRecord.findUnique({ where });
    if (existing) return { booked: true, already: true };
    try {
      await this.prisma.appointmentRecord.create({
        data: {
          activityId: dto.activityId,
          sceneId: dto.sceneId,
          userId,
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

/**
 * 访客信息：渠道码与设备上的访客 id 来自地址参数，登录用户 id 来自服务端验过的 C 端 token。
 * 灰度按设备分桶，只决定「看哪个版本」，不涉及任何权益，自报的访客 id 足够。
 */
function visitorOf(channel?: string, deviceId?: string, user?: RuntimeTokenPayload | null): GrayVisitor {
  return {
    channel: channel?.slice(0, 64) || undefined,
    deviceId: deviceId?.slice(0, 128) || undefined,
    userId: user?.sub,
  };
}

@ApiTags('runtime')
@Controller('runtime/activities')
@UseGuards(RuntimeUserGuard)
class RuntimeController {
  constructor(
    private readonly service: RuntimeService,
    private readonly prizeService: PrizeService,
  ) {}

  @Public()
  @Get(':id/dsl')
  @ApiOperation({ summary: '取这位访客该看的线上版本 DSL（灰度期间按渠道 / 白名单 / 设备分桶选版本）' })
  async dsl(
    @Param('id') id: string,
    @Query('ch') channel: string | undefined,
    @Query('gid') deviceId: string | undefined,
    @RuntimeUser() user: RuntimeTokenPayload | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.dsl(id, visitorOf(channel, deviceId, user));
    // 版本号放响应头而不是改 DSL：快照不可变，埋点与监控据此区分新旧版本
    res.setHeader('X-NCA-Version', String(result.version));
    if (result.gray) res.setHeader('X-NCA-Gray', '1');
    // 不同访客可能拿到不同版本，不能被共享缓存缓存
    res.setHeader('Cache-Control', 'private, no-cache');
    // 不包 { code, message, data }：Renderer 与直读 CDN 走同一条解析路径
    return markRaw(result.dsl);
  }

  @Public()
  @Get(':id/manifest')
  @ApiOperation({ summary: '取这位访客该看的线上版本 manifest' })
  async manifest(
    @Param('id') id: string,
    @Query('ch') channel: string | undefined,
    @Query('gid') deviceId: string | undefined,
    @RuntimeUser() user: RuntimeTokenPayload | null,
  ) {
    return markRaw(await this.service.manifest(id, visitorOf(channel, deviceId, user)));
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
@UseGuards(RuntimeUserGuard)
class RuntimeLotteryController {
  constructor(
    private readonly prizes: PrizeService,
    private readonly service: RuntimeService,
  ) {}

  @Public()
  @Post('draw')
  @ApiOperation({ summary: '抽奖：按概率选奖 + 原子扣减库存 + 落中奖记录' })
  async draw(
    @Body(new ZodValidationPipe(drawSchema)) dto: DrawDto,
    @RuntimeUser() user: RuntimeTokenPayload | null,
  ) {
    const userId = await this.service.resolveParticipant(dto.activityId, user, dto.userId);
    return markRaw(await this.prizes.draw(dto.activityId, userId));
  }
}

/** C 端写操作：表单提交 / 活动预约 */
@ApiTags('runtime')
@Controller('runtime')
@UseGuards(RuntimeUserGuard)
class RuntimeMutationController {
  constructor(private readonly service: RuntimeService) {}

  @Public()
  @Post('forms')
  @ApiOperation({ summary: '表单提交：写入 FormSubmission' })
  async submit(
    @Body(new ZodValidationPipe(submitFormSchema)) dto: SubmitFormDto,
    @RuntimeUser() user: RuntimeTokenPayload | null,
    @Ip() ip?: string,
  ) {
    const userId = await this.service.resolveParticipant(dto.activityId, user, dto.userId);
    return markRaw(await this.service.submitForm(dto, userId, ip));
  }

  @Public()
  @Post('appointment')
  @ApiOperation({ summary: '活动预约：一人一场次一次，重复预约返回 already' })
  async book(
    @Body(new ZodValidationPipe(appointmentSchema)) dto: AppointmentDto,
    @RuntimeUser() user: RuntimeTokenPayload | null,
  ) {
    const userId = await this.service.resolveParticipant(dto.activityId, user, dto.userId);
    return markRaw(await this.service.bookAppointment(dto, userId));
  }
}

@Module({
  imports: [PrizeModule, RuntimeAuthModule],
  controllers: [RuntimeController, RuntimeLotteryController, RuntimeMutationController],
  providers: [RuntimeService],
})
export class RuntimeModule {}

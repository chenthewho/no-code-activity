import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DSL_SCHEMA_VERSION,
  migrateDsl,
  validateFinalDsl,
  withCriticalAssets,
  type FinalDsl,
  type Manifest,
} from '@nca/dsl';
import {
  ACTIVITY_STATUS,
  ACTIVITY_STATUS_TRANSITIONS,
  type ActivityStatus,
  type GrayRule,
} from '@nca/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { MonitorService } from '../monitor/monitor.service';
import { StorageService } from '../storage/storage.service';
import { stampMetaFromActivity } from '../dsl/draft.service';
import { buildActivityUrl } from './activity-url';

export interface PublishResult {
  version: number;
  dslUrl: string;
  manifestUrl: string;
  activityUrl: string;
  /** 这次是灰度发布：只有命中规则的访问看到它 */
  gray?: boolean;
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly monitor: MonitorService,
  ) {}

  /**
   * 发布：草稿 → 严格校验 → 不可变版本快照 → 产物上传 → 切换线上指针。
   *
   * 全程持锁，避免两个人同时点发布抢到同一个版本号。
   */
  /**
   * 发布。gray 不为空时是灰度发布：生成同样不可变的版本快照，但只挂到 grayVersion 上，
   * 线上全量指针 publishedVersion 不动——命中规则的访问看新版，其余照旧，
   * 观察监控里新版的失败率没问题再全量。
   */
  async publish(
    activityId: string,
    userId: string,
    changelog?: string,
    gray?: GrayRule,
  ): Promise<PublishResult> {
    return this.redis.withLock(`publish:${activityId}`, async () => {
      const activity = await this.prisma.activity.findFirst({
        where: { id: activityId, deletedAt: null },
      });
      if (!activity) throw new NotFoundException('活动不存在');
      if (gray && (activity.status !== ACTIVITY_STATUS.PUBLISHED || !activity.publishedVersion)) {
        // 灰度是「新旧两版并存」，没有在线的全量版本时，不命中的人什么都看不到
        throw new BadRequestException('活动还没有在线的全量版本，首次发布请直接全量');
      }

      const draft = await this.prisma.dslDraft.findUnique({ where: { activityId } });
      if (!draft) throw new BadRequestException('活动尚无内容，请先在设计器中编辑');

      const {
        names: knownMaterials,
        versions: materialVersions,
        hosts: materialHosts,
      } = await this.loadEnabledMaterials();
      // 先迁移再校验：历史版本发布的 DSL 重新发布时，先沿迁移链推到当前协议
      const migrated = migrateDsl(draft.dsl);
      // publish 模式：草稿期只提示的「还没填」在这里升级为错误，拦住不完整的配置；
      // 节点物料版本高于注册表（渲染器还没跟上）同样拦住
      const result = validateFinalDsl(migrated.dsl, {
        knownMaterials,
        materialVersions,
        materialHosts,
        mode: 'publish',
      });
      if (!result.success) {
        const errors = result.issues.filter((i) => i.level === 'error');
        // 计入监控：「发布校验失败」频繁出现，往往是协议或物料升级出了问题，而不是运营手误
        void this.monitor.record('publish_invalid', activityId, `${errors.length} 项校验错误`, {
          issues: errors.slice(0, 5).map((i) => `${i.path}: ${i.message}`),
        });
        throw new BadRequestException({ message: '发布校验失败', errors: result.issues });
      }

      // 发布产物同样以基础信息为准，避免线上页读到过期的标题或活动时间；
      // 顺手标出首屏关键图片，渲染器启动时据此预加载
      const dsl = withCriticalAssets(this.stampMeta(result.data, activity));
      if (Object.keys(dsl.craftJson).length <= 1 && dsl.craftJson.ROOT?.nodes.length === 0) {
        throw new BadRequestException('页面还是空的，至少放置一个组件再发布');
      }

      const last = await this.prisma.activityVersion.findFirst({
        where: { activityId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;

      const dslContent = JSON.stringify(dsl);
      const dslKey = this.storage.buildKey(activityId, version, 'final-dsl.json', dslContent);
      const { url: dslUrl } = await this.storage.putText(dslKey, dslContent);

      const manifest: Manifest = {
        activityId,
        version,
        publishedAt: new Date().toISOString(),
        entry: {
          js: [this.config.getOrThrow<string>('RENDERER_ENTRY_JS')],
          css: [this.config.get<string>('RENDERER_ENTRY_CSS', '')].filter(Boolean),
        },
        dsl: dslUrl,
        runtime: {
          schemaVersion: dsl.schemaVersion,
          hosts: dsl.meta.hosts,
        },
      };
      const manifestContent = JSON.stringify(manifest);
      const manifestKey = this.storage.buildKey(activityId, version, 'manifest.json', manifestContent);
      const { url: manifestUrl } = await this.storage.putText(manifestKey, manifestContent);

      await this.prisma.$transaction([
        this.prisma.activityVersion.create({
          data: {
            activityId,
            version,
            dsl: dsl as unknown as Prisma.InputJsonValue,
            dslUrl,
            manifestUrl,
            changelog,
            createdBy: userId,
          },
        }),
        this.prisma.activity.update({
          where: { id: activityId },
          data: gray
            ? {
                grayVersion: version,
                grayRule: gray as unknown as Prisma.InputJsonValue,
                grayStartedAt: new Date(),
              }
            : {
                status: ACTIVITY_STATUS.PUBLISHED,
                publishedVersion: version,
                // 全量发布取代进行中的灰度
                grayVersion: null,
                grayRule: Prisma.DbNull,
                grayStartedAt: null,
              },
        }),
      ]);

      this.logger.log(`活动 ${activityId} ${gray ? '灰度' : ''}发布 v${version}`);
      return {
        version,
        dslUrl,
        manifestUrl,
        activityUrl: this.activityUrl(activityId),
        ...(gray ? { gray: true } : {}),
      };
    });
  }

  /**
   * 回滚：只把 publishedVersion 指针指回历史版本，不重新生成产物。
   * 历史版本的 DSL/manifest 在 CDN 上是不可变的，所以这一步是秒级且幂等的。
   */
  async rollback(activityId: string, targetVersion: number): Promise<PublishResult> {
    return this.redis.withLock(`publish:${activityId}`, async () => {
      const version = await this.prisma.activityVersion.findUnique({
        where: { activityId_version: { activityId, version: targetVersion } },
      });
      if (!version) throw new NotFoundException(`版本 v${targetVersion} 不存在`);
      if (!version.dslUrl || !version.manifestUrl) {
        throw new BadRequestException(`版本 v${targetVersion} 缺少发布产物，无法回滚`);
      }

      const activity = await this.prisma.activity.findFirst({
        where: { id: activityId },
        select: { grayVersion: true },
      });
      await this.prisma.activity.update({
        where: { id: activityId },
        data: {
          publishedVersion: targetVersion,
          status: ACTIVITY_STATUS.PUBLISHED,
          // 回滚到的正是灰度中的版本：等同转全量，灰度随之结束，免得两个指针指向同一版
          ...(activity?.grayVersion === targetVersion
            ? { grayVersion: null, grayRule: Prisma.DbNull, grayStartedAt: null }
            : {}),
        },
      });

      this.logger.warn(`活动 ${activityId} 回滚至 v${targetVersion}`);
      return {
        version: targetVersion,
        dslUrl: version.dslUrl,
        manifestUrl: version.manifestUrl,
        activityUrl: this.activityUrl(activityId),
      };
    });
  }

  /** 调整灰度范围（扩大比例、加渠道、加白名单），版本不变 */
  async updateGray(activityId: string, rule: GrayRule): Promise<void> {
    const activity = await this.grayingActivity(activityId);
    await this.prisma.activity.update({
      where: { id: activity.id },
      data: { grayRule: rule as unknown as Prisma.InputJsonValue },
    });
  }

  /** 灰度转全量：把全量指针切到灰度版本。和回滚一样只切指针，秒级生效 */
  async promoteGray(activityId: string): Promise<PublishResult> {
    return this.redis.withLock(`publish:${activityId}`, async () => {
      const activity = await this.grayingActivity(activityId);
      const version = await this.prisma.activityVersion.findUnique({
        where: { activityId_version: { activityId, version: activity.grayVersion! } },
      });
      if (!version?.dslUrl || !version.manifestUrl) throw new BadRequestException('灰度版本缺少发布产物');
      await this.prisma.activity.update({
        where: { id: activityId },
        data: {
          publishedVersion: version.version,
          status: ACTIVITY_STATUS.PUBLISHED,
          grayVersion: null,
          grayRule: Prisma.DbNull,
          grayStartedAt: null,
        },
      });
      this.logger.log(`活动 ${activityId} 灰度 v${version.version} 转全量`);
      return {
        version: version.version,
        dslUrl: version.dslUrl,
        manifestUrl: version.manifestUrl,
        activityUrl: this.activityUrl(activityId),
      };
    });
  }

  /** 停止灰度：所有人回到全量版本，灰度版本快照保留在历史里 */
  async stopGray(activityId: string): Promise<void> {
    const activity = await this.grayingActivity(activityId);
    await this.prisma.activity.update({
      where: { id: activity.id },
      data: { grayVersion: null, grayRule: Prisma.DbNull, grayStartedAt: null },
    });
    this.logger.warn(`活动 ${activityId} 停止灰度 v${activity.grayVersion}`);
  }

  private async grayingActivity(activityId: string) {
    const activity = await this.prisma.activity.findFirst({ where: { id: activityId, deletedAt: null } });
    if (!activity) throw new NotFoundException('活动不存在');
    if (!activity.grayVersion) throw new BadRequestException('该活动当前没有进行中的灰度');
    return activity;
  }

  async changeStatus(activityId: string, next: ActivityStatus): Promise<void> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { status: true, publishedVersion: true },
    });
    if (!activity) throw new NotFoundException('活动不存在');

    const allowed = ACTIVITY_STATUS_TRANSITIONS[activity.status];
    if (!allowed.includes(next)) {
      throw new BadRequestException(`不允许从 ${activity.status} 变更为 ${next}`);
    }
    if (next === ACTIVITY_STATUS.PUBLISHED && !activity.publishedVersion) {
      throw new BadRequestException('该活动尚未发布过任何版本');
    }

    await this.prisma.activity.update({ where: { id: activityId }, data: { status: next } });
  }

  async listVersions(activityId: string) {
    return this.prisma.activityVersion.findMany({
      where: { activityId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        changelog: true,
        createdBy: true,
        createdAt: true,
        dslUrl: true,
        manifestUrl: true,
      },
    });
  }

  private async loadEnabledMaterials(): Promise<{
    names?: Set<string>;
    versions?: Record<string, string>;
    hosts?: Record<string, string[] | undefined>;
  }> {
    const rows = await this.prisma.material.findMany({
      where: { enabled: true },
      select: { name: true, version: true, meta: true },
    });
    // 注册表为空说明没跑 seed，此时跳过物料校验而不是把所有发布都拦死
    if (rows.length === 0) {
      this.logger.warn('物料注册表为空，跳过物料名校验，请执行 pnpm --filter @nca/server seed');
      return {};
    }
    return {
      names: new Set(rows.map((r) => r.name)),
      versions: Object.fromEntries(rows.map((r) => [r.name, r.version])),
      hosts: Object.fromEntries(
        rows.map((r) => [r.name, (r.meta as { supportedHosts?: string[] } | null)?.supportedHosts]),
      ),
    };
  }

  private stampMeta(
    dsl: FinalDsl,
    activity: { id: string; title: string; cover: string | null; startTime: Date | null; endTime: Date | null },
  ): FinalDsl {
    return {
      ...stampMetaFromActivity(dsl, activity),
      schemaVersion: DSL_SCHEMA_VERSION,
    };
  }

  private activityUrl(activityId: string): string {
    const base = this.config.get<string>('ACTIVITY_BASE_URL') || 'http://localhost:5180';
    return buildActivityUrl(base, activityId);
  }
}

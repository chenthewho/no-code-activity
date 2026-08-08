import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DSL_SCHEMA_VERSION,
  migrateDsl,
  validateFinalDsl,
  type FinalDsl,
  type Manifest,
} from '@nca/dsl';
import { ACTIVITY_STATUS, ACTIVITY_STATUS_TRANSITIONS, type ActivityStatus } from '@nca/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { stampMetaFromActivity } from '../dsl/draft.service';
import { buildActivityUrl } from './activity-url';

export interface PublishResult {
  version: number;
  dslUrl: string;
  manifestUrl: string;
  activityUrl: string;
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 发布：草稿 → 严格校验 → 不可变版本快照 → 产物上传 → 切换线上指针。
   *
   * 全程持锁，避免两个人同时点发布抢到同一个版本号。
   */
  async publish(activityId: string, userId: string, changelog?: string): Promise<PublishResult> {
    return this.redis.withLock(`publish:${activityId}`, async () => {
      const activity = await this.prisma.activity.findFirst({
        where: { id: activityId, deletedAt: null },
      });
      if (!activity) throw new NotFoundException('活动不存在');

      const draft = await this.prisma.dslDraft.findUnique({ where: { activityId } });
      if (!draft) throw new BadRequestException('活动尚无内容，请先在设计器中编辑');

      const knownMaterials = await this.loadEnabledMaterials();
      // 先迁移再校验：历史版本发布的 DSL 重新发布时，先沿迁移链推到当前协议
      const migrated = migrateDsl(draft.dsl);
      // publish 模式：草稿期只提示的「还没填」在这里升级为错误，拦住不完整的配置
      const result = validateFinalDsl(migrated.dsl, { knownMaterials, mode: 'publish' });
      if (!result.success) {
        throw new BadRequestException({ message: '发布校验失败', errors: result.issues });
      }

      // 发布产物同样以基础信息为准，避免线上页读到过期的标题或活动时间
      const dsl = this.stampMeta(result.data, activity);
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
          data: { status: ACTIVITY_STATUS.PUBLISHED, publishedVersion: version },
        }),
      ]);

      this.logger.log(`活动 ${activityId} 发布 v${version}`);
      return { version, dslUrl, manifestUrl, activityUrl: this.activityUrl(activityId) };
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

      await this.prisma.activity.update({
        where: { id: activityId },
        data: { publishedVersion: targetVersion, status: ACTIVITY_STATUS.PUBLISHED },
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

  private async loadEnabledMaterials(): Promise<Set<string>> {
    const rows = await this.prisma.material.findMany({
      where: { enabled: true },
      select: { name: true },
    });
    // 注册表为空说明没跑 seed，此时跳过物料校验而不是把所有发布都拦死
    if (rows.length === 0) {
      this.logger.warn('物料注册表为空，跳过物料名校验，请执行 pnpm --filter @nca/server seed');
      return new Set();
    }
    return new Set(rows.map((r) => r.name));
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

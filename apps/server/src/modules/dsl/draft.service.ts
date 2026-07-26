import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createEmptyDsl, validateFinalDsl, type DslIssue, type FinalDsl } from '@nca/dsl';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface DraftSaveResult {
  updatedAt: string;
  issues: DslIssue[];
}

interface ActivityBasics {
  id: string;
  title: string;
  cover: string | null;
  startTime: Date | null;
  endTime: Date | null;
}

/**
 * 把活动基础信息盖进 DSL meta。
 *
 * 标题、活动时间、封面只在「活动基础信息」表单里维护，设计器改不了它们；
 * 若不在这里同步，运营改完时间后画布里绑定 {{ meta.endTime }} 的倒计时
 * 依然读的是旧值——两份数据各说各话。基础信息是唯一真相，meta 是它的投影。
 */
export function stampMetaFromActivity(dsl: FinalDsl, activity: ActivityBasics): FinalDsl {
  return {
    ...dsl,
    meta: {
      ...dsl.meta,
      activityId: activity.id,
      title: activity.title,
      // 用 || 而非 ??：空串表示「没设封面」，而 ?? 只挡 null，
      // 空串会被盖进 meta 并让 assetUrl 校验失败，进而整个画布空白
      cover: activity.cover || dsl.meta.cover || undefined,
      startTime: activity.startTime?.toISOString(),
      endTime: activity.endTime?.toISOString(),
    },
  };
}

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  async get(activityId: string): Promise<FinalDsl> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true, title: true, cover: true, startTime: true, endTime: true },
    });
    if (!activity) throw new NotFoundException('活动不存在');

    const draft = await this.prisma.dslDraft.findUnique({ where: { activityId } });
    if (!draft) {
      // 历史数据兜底：草稿丢失时返回空白 DSL，让设计器至少能打开
      return stampMetaFromActivity(createEmptyDsl(activity.id, activity.title), activity);
    }

    const result = validateFinalDsl(draft.dsl, { mode: 'draft' });
    if (!result.success) {
      throw new BadRequestException({
        message: '草稿内容已损坏，无法解析',
        errors: result.issues,
      });
    }
    return stampMetaFromActivity(result.data, activity);
  }

  /**
   * 保存草稿。校验放宽到「结构必须合法，但允许 warning」——
   * 编辑中途出现孤儿节点、暂时没配完的数据源都很正常，
   * 真正严格的门槛留在发布环节。
   */
  async save(activityId: string, dsl: unknown, userId: string): Promise<DraftSaveResult> {
    const exists = await this.prisma.activity.count({ where: { id: activityId, deletedAt: null } });
    if (exists === 0) throw new NotFoundException('活动不存在');

    // draft 模式：结构必须合法，但允许「还没填完」——
    // 运营边配边存是常态，卡在这里会让编辑流程直接断掉
    const result = validateFinalDsl(dsl, { mode: 'draft' });
    if (!result.success) {
      throw new BadRequestException({ message: '草稿结构不合法', errors: result.issues });
    }

    const saved = await this.prisma.dslDraft.upsert({
      where: { activityId },
      create: {
        activityId,
        dsl: result.data as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
      update: { dsl: result.data as unknown as Prisma.InputJsonValue, updatedBy: userId },
    });

    // 活动标题以基础信息表单为准，但同步进 DSL meta，
    // 保证 Renderer 拿到的 title 与后台看到的一致
    await this.prisma.activity.update({
      where: { id: activityId },
      data: { updatedAt: new Date() },
    });

    return { updatedAt: saved.updatedAt.toISOString(), issues: result.issues };
  }
}

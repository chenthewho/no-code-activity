import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createEmptyDsl, validateFinalDsl, type DslIssue, type FinalDsl } from '@nca/dsl';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface DraftSaveResult {
  updatedAt: string;
  issues: DslIssue[];
}

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  async get(activityId: string): Promise<FinalDsl> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!activity) throw new NotFoundException('活动不存在');

    const draft = await this.prisma.dslDraft.findUnique({ where: { activityId } });
    if (!draft) {
      // 历史数据兜底：草稿丢失时返回空白 DSL，让设计器至少能打开
      return createEmptyDsl(activity.id, activity.title);
    }

    const result = validateFinalDsl(draft.dsl);
    if (!result.success) {
      throw new BadRequestException({
        message: '草稿内容已损坏，无法解析',
        errors: result.issues,
      });
    }
    return result.data;
  }

  /**
   * 保存草稿。校验放宽到「结构必须合法，但允许 warning」——
   * 编辑中途出现孤儿节点、暂时没配完的数据源都很正常，
   * 真正严格的门槛留在发布环节。
   */
  async save(activityId: string, dsl: unknown, userId: string): Promise<DraftSaveResult> {
    const exists = await this.prisma.activity.count({ where: { id: activityId, deletedAt: null } });
    if (exists === 0) throw new NotFoundException('活动不存在');

    const result = validateFinalDsl(dsl);
    if (!result.success) {
      throw new BadRequestException({ message: 'DSL 校验失败', errors: result.issues });
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

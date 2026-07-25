import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createEmptyDsl, finalDslSchema, type FinalDsl } from '@nca/dsl';
import { ACTIVITY_STATUS, type ActivitySummary, type PageResult } from '@nca/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateActivityDto, ListActivityDto, UpdateActivityDto } from './activity.dto';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListActivityDto): Promise<PageResult<ActivitySummary>> {
    const where: Prisma.ActivityWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { owner: { select: { nickname: true } } },
      }),
      this.prisma.activity.count({ where }),
    ]);

    return {
      list: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        cover: row.cover ?? undefined,
        startTime: row.startTime?.toISOString(),
        endTime: row.endTime?.toISOString(),
        publishedVersion: row.publishedVersion ?? undefined,
        ownerId: row.ownerId,
        ownerName: row.owner.nickname,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string) {
    const activity = await this.prisma.activity.findFirst({
      where: { id, deletedAt: null },
      include: { owner: { select: { nickname: true } } },
    });
    if (!activity) throw new NotFoundException('活动不存在');
    return activity;
  }

  /**
   * 新建活动。活动记录与初始草稿在同一事务里落库——
   * 否则一旦草稿写失败，设计器打开就是一个没有 ROOT 节点的空壳。
   */
  async create(dto: CreateActivityDto, ownerId: string) {
    let initialDsl: FinalDsl | null = null;
    if (dto.templateId) {
      const template = await this.prisma.template.findUnique({ where: { id: dto.templateId } });
      if (!template) throw new NotFoundException('模板不存在');
      const parsed = finalDslSchema.safeParse(template.dsl);
      if (!parsed.success) throw new BadRequestException('模板内容已损坏，无法用于创建活动');
      initialDsl = parsed.data;
    }

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.activity.create({
        data: {
          title: dto.title,
          description: dto.description,
          cover: dto.cover,
          startTime: dto.startTime ? new Date(dto.startTime) : null,
          endTime: dto.endTime ? new Date(dto.endTime) : null,
          status: ACTIVITY_STATUS.DRAFT,
          ownerId,
        },
      });

      const dsl = initialDsl
        ? { ...initialDsl, meta: { ...initialDsl.meta, activityId: activity.id, title: dto.title } }
        : createEmptyDsl(activity.id, dto.title);

      await tx.dslDraft.create({
        data: { activityId: activity.id, dsl: dsl as unknown as Prisma.InputJsonValue, updatedBy: ownerId },
      });

      if (dto.templateId) {
        await tx.template.update({
          where: { id: dto.templateId },
          data: { useCount: { increment: 1 } },
        });
      }

      return activity;
    });
  }

  async update(id: string, dto: UpdateActivityDto) {
    await this.detail(id);
    return this.prisma.activity.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        cover: dto.cover,
        startTime: dto.startTime ? new Date(dto.startTime) : undefined,
        endTime: dto.endTime ? new Date(dto.endTime) : undefined,
      },
    });
  }

  /** 软删除：已发布的活动线上还在跑，不能物理删 */
  async remove(id: string) {
    const activity = await this.detail(id);
    if (activity.status === ACTIVITY_STATUS.PUBLISHED) {
      throw new BadRequestException('活动仍在线上，请先下线再删除');
    }
    await this.prisma.activity.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async copy(id: string, ownerId: string) {
    const source = await this.detail(id);
    const draft = await this.prisma.dslDraft.findUnique({ where: { activityId: id } });

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.activity.create({
        data: {
          title: `${source.title} - 副本`,
          description: source.description,
          cover: source.cover,
          startTime: source.startTime,
          endTime: source.endTime,
          status: ACTIVITY_STATUS.DRAFT,
          ownerId,
        },
      });

      const parsed = draft ? finalDslSchema.safeParse(draft.dsl) : null;
      const dsl =
        parsed?.success === true
          ? { ...parsed.data, meta: { ...parsed.data.meta, activityId: activity.id, title: activity.title } }
          : createEmptyDsl(activity.id, activity.title);

      await tx.dslDraft.create({
        data: { activityId: activity.id, dsl: dsl as unknown as Prisma.InputJsonValue, updatedBy: ownerId },
      });
      return activity;
    });
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createEmptyDsl, finalDslSchema, type FinalDsl } from '@nca/dsl';
import { ACTIVITY_STATUS, type ActivitySummary, type PageResult } from '@nca/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ActivityAccessService } from '../access/activity-access.service';
import type { JwtPayload } from '../auth/auth.types';
import type { CreateActivityDto, ListActivityDto, UpdateActivityDto, UpsertMemberDto } from './activity.dto';

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ActivityAccessService,
  ) {}

  async list(query: ListActivityDto, user: JwtPayload): Promise<PageResult<ActivitySummary>> {
    const where: Prisma.ActivityWhereInput = {
      deletedAt: null,
      ...this.access.scopeWhere(user, query.scope),
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
    const access = await this.access.accessMap(user, rows);

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
        access: access[row.id],
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

  /** 详情带上负责人昵称与当前用户的访问级别，前端据此决定按钮显隐 */
  async detailFor(id: string, user: JwtPayload) {
    const activity = await this.detail(id);
    const access = await this.access.resolve(user, id);
    return { ...activity, ownerName: activity.owner.nickname, access };
  }

  // ── 协作成员 ────────────────────────────────────────────

  async members(id: string) {
    const activity = await this.prisma.activity.findFirst({
      where: { id, deletedAt: null },
      select: {
        owner: { select: { id: true, username: true, nickname: true } },
        members: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, createdAt: true, user: { select: { id: true, username: true, nickname: true } } },
        },
      },
    });
    if (!activity) throw new NotFoundException('活动不存在');
    return {
      owner: activity.owner,
      members: activity.members.map((m) => ({ ...m.user, role: m.role, createdAt: m.createdAt.toISOString() })),
    };
  }

  async upsertMember(id: string, dto: UpsertMemberDto, actorId: string) {
    const [activity, user] = await Promise.all([
      this.detail(id),
      this.prisma.user.findUnique({ where: { id: dto.userId } }),
    ]);
    if (!user?.enabled) throw new BadRequestException('用户不存在或已停用');
    if (activity.ownerId === dto.userId) throw new BadRequestException('负责人无需再添加为成员');
    await this.prisma.activityMember.upsert({
      where: { activityId_userId: { activityId: id, userId: dto.userId } },
      create: { activityId: id, userId: dto.userId, role: dto.role, addedBy: actorId },
      update: { role: dto.role },
    });
  }

  async removeMember(id: string, userId: string) {
    await this.prisma.activityMember.deleteMany({ where: { activityId: id, userId } });
  }

  /** 转交负责人：原负责人降为编辑成员，不会因为交接就失去访问权 */
  async transferOwner(id: string, userId: string) {
    const [activity, user] = await Promise.all([this.detail(id), this.prisma.user.findUnique({ where: { id: userId } })]);
    if (!user?.enabled) throw new BadRequestException('用户不存在或已停用');
    if (activity.ownerId === userId) return;
    await this.prisma.$transaction([
      this.prisma.activity.update({ where: { id }, data: { ownerId: userId } }),
      this.prisma.activityMember.deleteMany({ where: { activityId: id, userId } }),
      this.prisma.activityMember.upsert({
        where: { activityId_userId: { activityId: id, userId: activity.ownerId } },
        create: { activityId: id, userId: activity.ownerId, role: 'editor' },
        update: { role: 'editor' },
      }),
    ]);
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

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AppointmentScene } from '@prisma/client';
import type { AppointmentSceneStatus, AppointmentSceneView } from '@nca/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppointmentDto, CreateSceneDto, UpdateSceneDto } from './appointment.dto';

type SceneRow = Pick<AppointmentScene, 'startAt' | 'endAt' | 'capacity' | 'booked'>;

/** 开场即停止预约；只设了结束时间的，到结束为止 */
export function sceneClosed(scene: Pick<SceneRow, 'startAt' | 'endAt'>, now: Date): boolean {
  if (scene.startAt) return now >= scene.startAt;
  return Boolean(scene.endAt && now >= scene.endAt);
}

export function sceneStatus(scene: SceneRow, now: Date): AppointmentSceneStatus {
  if (sceneClosed(scene, now)) return 'closed';
  if (scene.capacity !== null && scene.booked >= scene.capacity) return 'full';
  return 'open';
}

class SceneFullError extends Error {}

const ORDER = [{ sort: 'asc' as const }, { startAt: 'asc' as const }, { createdAt: 'asc' as const }];

/**
 * 预约场次（时段）与预约。
 *
 * 名额用「比较并自增」的一条 UPDATE 占位，和落预约记录放在同一个事务里：
 * 记录因重复预约写不进去时，占的名额随事务一起回滚，并发下既不超卖也不漏算。
 */
@Injectable()
export class AppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  list(activityId: string) {
    return this.prisma.appointmentScene.findMany({ where: { activityId }, orderBy: ORDER });
  }

  async create(dto: CreateSceneDto) {
    try {
      return await this.prisma.appointmentScene.create({
        data: {
          activityId: dto.activityId,
          sceneId: dto.sceneId,
          name: dto.name,
          startAt: dto.startAt ? new Date(dto.startAt) : null,
          endAt: dto.endAt ? new Date(dto.endAt) : null,
          capacity: dto.capacity ?? null,
          sort: dto.sort,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(`场次编码 ${dto.sceneId} 已存在`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateSceneDto) {
    const scene = await this.prisma.appointmentScene.findUnique({ where: { id } });
    if (!scene) throw new NotFoundException('场次不存在');
    if (dto.capacity != null && dto.capacity < scene.booked) {
      throw new BadRequestException(`已有 ${scene.booked} 人预约，名额不能少于这个数`);
    }
    const startAt = dto.startAt === undefined ? scene.startAt : dto.startAt && new Date(dto.startAt);
    const endAt = dto.endAt === undefined ? scene.endAt : dto.endAt && new Date(dto.endAt);
    if (startAt && endAt && endAt <= startAt) throw new BadRequestException('结束时间要晚于开始时间');
    return this.prisma.appointmentScene.update({
      where: { id },
      data: {
        name: dto.name,
        startAt,
        endAt,
        capacity: dto.capacity,
        sort: dto.sort,
      },
    });
  }

  async remove(id: string) {
    const scene = await this.prisma.appointmentScene.findUnique({ where: { id } });
    if (!scene) throw new NotFoundException('场次不存在');
    // 删了的话，已经约上的人在页面上就找不到自己的场次了
    if (scene.booked > 0) throw new BadRequestException('已有人预约的场次不能删除');
    await this.prisma.appointmentScene.delete({ where: { id } });
  }

  /** C 端场次列表：剩余名额、状态，以及这位访问者约过哪些 */
  async publicList(activityId: string, viewerId?: string, now = new Date()): Promise<AppointmentSceneView[]> {
    const scenes = await this.prisma.appointmentScene.findMany({ where: { activityId }, orderBy: ORDER });
    if (scenes.length === 0) return [];
    const mine = viewerId
      ? await this.prisma.appointmentRecord.findMany({
          where: { activityId, userId: viewerId, status: 'confirmed' },
          select: { sceneId: true },
        })
      : [];
    const booked = new Set(mine.map((r) => r.sceneId));
    return scenes.map((s) => ({
      sceneId: s.sceneId,
      name: s.name,
      startAt: s.startAt?.toISOString(),
      endAt: s.endAt?.toISOString(),
      capacity: s.capacity,
      remaining: s.capacity === null ? null : Math.max(0, s.capacity - s.booked),
      status: sceneStatus(s, now),
      booked: booked.has(s.sceneId),
    }));
  }

  /** 预约：一人一场次一次，重复预约返回 already；约满、已开场、场次不存在直接拒绝 */
  async book(dto: AppointmentDto, userId: string, now = new Date()) {
    const record = { activityId: dto.activityId, sceneId: dto.sceneId, userId };
    const existing = await this.prisma.appointmentRecord.findUnique({
      where: { activityId_sceneId_userId: record },
    });
    if (existing) return { booked: true, already: true };

    const scene = await this.prisma.appointmentScene.findUnique({
      where: { activityId_sceneId: { activityId: dto.activityId, sceneId: dto.sceneId } },
    });
    if (!scene) {
      // 配了场次就只认配置里的场次；一个都没配是早期活动，保持不限场次与名额
      const configured = await this.prisma.appointmentScene.count({ where: { activityId: dto.activityId } });
      if (configured > 0) throw new BadRequestException('预约场次不存在');
    } else if (sceneClosed(scene, now)) {
      throw new BadRequestException('该场次已开始，停止预约');
    }

    const data = { ...record, contact: dto.contact ?? null };
    try {
      await this.prisma.$transaction(async (tx) => {
        if (scene) {
          const taken = await tx.$executeRaw`
            UPDATE appointment_scene SET booked = booked + 1
            WHERE id = ${scene.id} AND (capacity IS NULL OR booked < capacity)`;
          if (taken === 0) throw new SceneFullError();
        }
        await tx.appointmentRecord.create({ data });
      });
    } catch (err) {
      if (err instanceof SceneFullError) {
        throw new BadRequestException({ message: '该场次已约满', reason: 'FULL' });
      }
      // 并发下同一人同时点了两次：唯一约束挡住第二条，占的名额随事务回滚
      if ((err as { code?: string }).code === 'P2002') return { booked: true, already: true };
      throw err;
    }
    return { booked: true, already: false };
  }
}

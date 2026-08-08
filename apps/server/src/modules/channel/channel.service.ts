import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildActivityUrl } from '../publish/activity-url';
import type { CreateChannelDto } from './channel.dto';

type ChannelParams = Record<string, string | number | boolean>;

@Injectable()
export class ChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 生成渠道落地链接：站点根 + /act/:id + ?ch=<code>&<params>。
   * 落地页 renderer 的表达式上下文里有 query，运营可用 {{ query.ch }} 做渠道差异化展示。
   */
  private buildLink(activityId: string, code: string, params?: ChannelParams | null): string {
    const base = this.config.get<string>('ACTIVITY_BASE_URL') || 'http://localhost:5180';
    const url = new URL(buildActivityUrl(base, activityId));
    url.searchParams.set('ch', code);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async list(activityId: string) {
    const rows = await this.prisma.channel.findMany({
      where: { activityId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((c) => ({ ...c, link: this.buildLink(c.activityId, c.code, c.params as ChannelParams) }));
  }

  async create(dto: CreateChannelDto) {
    // 先查再建给运营友好提示；@@unique 兜底并发，命中 P2002 也转成 400
    const existing = await this.prisma.channel.findUnique({
      where: { activityId_code: { activityId: dto.activityId, code: dto.code } },
    });
    if (existing) throw new BadRequestException(`渠道码 ${dto.code} 已存在`);
    let channel;
    try {
      channel = await this.prisma.channel.create({
        data: {
          activityId: dto.activityId,
          name: dto.name,
          code: dto.code,
          params: (dto.params ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException(`渠道码 ${dto.code} 已存在`);
      }
      throw err;
    }
    return {
      ...channel,
      link: this.buildLink(channel.activityId, channel.code, channel.params as ChannelParams),
    };
  }

  async remove(id: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('渠道不存在');
    await this.prisma.channel.delete({ where: { id } });
  }
}

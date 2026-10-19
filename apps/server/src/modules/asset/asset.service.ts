import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PageResult } from '@nca/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { randomToken } from '../sso/oidc.client';
import { CosService, type DirectUpload } from '../storage/cos.service';
import { StorageService } from '../storage/storage.service';
import type { CompleteUploadDto, ListDto, RegisterDto, UploadTicketDto } from './asset.dto';

/** 与图片相关的白名单。视频/字体等按需再放开 */
export const ALLOWED_MIME = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['video/mp4', '.mp4'],
]);

/** 服务端中转的上限：文件整个进内存，不能放太大 */
export const MAX_PROXY_BYTES = 10 * 1024 * 1024;
/** 直传不经过应用服务器，上限只受业务约束 */
export const MAX_DIRECT_BYTES = 200 * 1024 * 1024;

/** 签发后多久内必须传完并确认，超时的登记直接作废 */
const PENDING_TTL_MS = 30 * 60 * 1000;

/**
 * 只声明实际用到的字段，而不依赖 @types/multer 的全局 Express 命名空间扩展——
 * 该扩展在 multer 类型包大版本间反复变动，绑上去等于给自己埋升级坑。
 */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface AssetItem {
  id: string;
  url: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
}

/**
 * 上传凭证。三种结果，前端照 mode 分支：
 * reused —— 同内容早已上传过，直接用；proxy —— 未配 COS，走服务端中转；
 * cos —— 照 uploadUrl/headers 直传，传完调 upload-complete 登记。
 */
export type UploadTicket =
  | { mode: 'reused'; id: string; url: string }
  | { mode: 'proxy'; maxBytes: number }
  | ({ mode: 'cos'; uploadId: string; url: string } & DirectUpload);

interface PendingUpload {
  key: string;
  url: string;
  hash: string;
  size: number;
  mimetype: string;
  userId: string;
  activityId: string | null;
}

@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cos: CosService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async list(query: ListDto): Promise<PageResult<AssetItem>> {
    const where = {
      ...(query.activityId ? { activityId: query.activityId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.asset.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        url: row.url,
        type: row.type,
        size: row.size,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 直传第一步：校验类型与大小、按内容哈希去重，然后签发只能写这一个对象的凭证。
   *
   * 哈希由前端计算、服务端不复核（复核就得把文件下载一遍，直传的意义就没了），所以：
   * - 复用只认服务端算过哈希的素材，或本人之前直传的——报一个别人图片的哈希，
   *   骗不到别人的地址，也没法让别人之后上传同一张图时拿到自己传的内容；
   * - 直传对象的 key 带上本次 uploadId，各传各的，谁都覆盖不了别人的对象。
   */
  async createUploadTicket(dto: UploadTicketDto, userId: string): Promise<UploadTicket> {
    const ext = this.assertAcceptable(
      dto.mimetype,
      dto.size,
      this.cos.enabled ? MAX_DIRECT_BYTES : MAX_PROXY_BYTES,
    );

    const existing = await this.prisma.asset.findFirst({
      where: { hash: dto.sha256, OR: [{ hashVerified: true }, { uploadedBy: userId }] },
    });
    if (existing) return { mode: 'reused', id: existing.id, url: existing.url };

    if (!this.cos.enabled) return { mode: 'proxy', maxBytes: MAX_PROXY_BYTES };

    const uploadId = randomToken(18);
    const key = directAssetKey(dto.sha256, uploadId, ext);
    const expires = this.config.get<number>('COS_UPLOAD_EXPIRES') ?? 900;
    const direct = await this.cos.createDirectUpload(key, dto.mimetype, expires);
    const pending: PendingUpload = {
      key,
      url: this.storage.publicUrl(key),
      hash: dto.sha256,
      size: dto.size,
      mimetype: dto.mimetype,
      userId,
      activityId: dto.activityId ?? null,
    };
    await this.redis.set(pendingKey(uploadId), JSON.stringify(pending), PENDING_TTL_MS);
    return { mode: 'cos', uploadId, url: pending.url, ...direct };
  }

  /**
   * 直传第二步：确认对象真的到了桶里、大小也对得上，才登记成素材。
   * 只认自己签发的 uploadId——前端不能随便报一个 URL 进素材库。
   */
  async completeUpload(dto: CompleteUploadDto, userId: string) {
    const raw = await this.redis.take(pendingKey(dto.uploadId));
    if (!raw) throw new BadRequestException('上传凭证无效或已过期，请重新上传');
    const pending = JSON.parse(raw) as PendingUpload;
    if (pending.userId !== userId) throw new BadRequestException('上传凭证不属于当前用户');

    const head = await this.cos.headObject(pending.key);
    if (!head.exists) throw new BadRequestException('文件尚未上传到存储桶');
    if (head.size !== pending.size) {
      throw new BadRequestException(`文件大小不一致（声明 ${pending.size}，实际 ${head.size}）`);
    }
    // 类型以签发时校验过的为准：传上去的若被换成 text/html，CDN 上就多了一个能执行脚本的页面
    if (head.contentType && head.contentType.split(';')[0]!.trim() !== pending.mimetype) {
      throw new BadRequestException(`文件类型不一致（声明 ${pending.mimetype}，实际 ${head.contentType}）`);
    }

    const asset = await this.prisma.asset.create({
      data: {
        url: pending.url,
        type: assetType(pending.mimetype),
        size: pending.size,
        hash: pending.hash,
        hashVerified: false,
        activityId: pending.activityId,
        uploadedBy: userId,
      },
    });
    return { url: asset.url, id: asset.id, reused: false };
  }

  /**
   * 服务端中转上传：未配 COS 的本地环境，以及直传不可用时的兜底。
   * 返回形状与直传完成后一致（{ url, id, reused }），前端不用区分。
   */
  async upload(file: UploadedFileLike, userId: string, activityId?: string) {
    if (!file) throw new BadRequestException('请选择文件');
    const ext = this.assertAcceptable(file.mimetype, file.size, MAX_PROXY_BYTES);

    // 内容寻址：同一张图重复上传不会产生副本，也天然可长缓存
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    // 服务端自己算的哈希：只复用同样经过服务端核实的记录
    const existing = await this.prisma.asset.findFirst({ where: { hash, hashVerified: true } });
    if (existing) {
      return { url: existing.url, id: existing.id, reused: true };
    }

    const { url } = await this.storage.putBuffer(assetKey(hash, ext), file.buffer, file.mimetype);
    const asset = await this.prisma.asset.create({
      data: {
        url,
        type: assetType(file.mimetype),
        size: file.size,
        hash,
        activityId: activityId ?? null,
        uploadedBy: userId,
      },
    });

    return { url, id: asset.id, reused: false };
  }

  async register(dto: RegisterDto, userId: string) {
    return this.prisma.asset.create({
      data: {
        url: dto.url,
        type: dto.type,
        size: dto.size,
        width: dto.width,
        height: dto.height,
        activityId: dto.activityId ?? null,
        uploadedBy: userId,
      },
    });
  }

  private assertAcceptable(mimetype: string, size: number, maxBytes: number): string {
    const ext = ALLOWED_MIME.get(mimetype);
    if (!ext) throw new BadRequestException(`不支持的文件类型：${mimetype}`);
    if (size > maxBytes) {
      throw new BadRequestException(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
    }
    return ext;
  }
}

export function assetKey(hash: string, ext: string): string {
  return `assets/${hash.slice(0, 2)}/${hash}${ext}`;
}

/** 直传对象的 key：哈希是浏览器报的，带上 uploadId 让每次直传落在自己的对象上 */
export function directAssetKey(hash: string, uploadId: string, ext: string): string {
  return `assets/direct/${hash.slice(0, 2)}/${hash}-${uploadId}${ext}`;
}

function assetType(mimetype: string): string {
  return mimetype.startsWith('video') ? 'video' : 'image';
}

const pendingKey = (uploadId: string): string => `nca:upload:${uploadId}`;

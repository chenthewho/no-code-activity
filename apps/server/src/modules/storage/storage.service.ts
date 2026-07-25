import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface PutResult {
  key: string;
  url: string;
}

/**
 * 对象存储抽象。
 *
 * 未配置 COS 时写本地目录并由 /static 静态托管，让本地能完整跑通
 * 「发布 → 拿到 URL → 打开活动页」这条链路，不必先备齐云资源。
 * 接入 COS 只需实现 putToCos，调用方无感。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly localDir: string;
  private readonly cdnBase: string;
  private readonly cosEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.localDir = resolve(this.config.get<string>('PUBLISH_LOCAL_DIR', './.publish'));
    this.cdnBase = this.config.get<string>('CDN_BASE_URL', 'http://localhost:3100/static').replace(/\/$/, '');
    this.cosEnabled = Boolean(this.config.get<string>('COS_BUCKET'));
    if (!this.cosEnabled) {
      this.logger.warn(`未配置 COS，发布产物写入本地目录 ${this.localDir}`);
    }
  }

  get staticRoot(): string {
    return this.localDir;
  }

  /** 内容寻址：同内容同 URL，天然带缓存友好性，也避免重复发布产生垃圾文件 */
  buildKey(activityId: string, version: number, filename: string, content: string): string {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
    const dot = filename.lastIndexOf('.');
    const name = dot === -1 ? filename : filename.slice(0, dot);
    const ext = dot === -1 ? '' : filename.slice(dot);
    return `activities/${activityId}/v${version}/${name}.${hash}${ext}`;
  }

  async putJson(key: string, payload: unknown): Promise<PutResult> {
    return this.putText(key, JSON.stringify(payload));
  }

  async putText(key: string, content: string): Promise<PutResult> {
    if (this.cosEnabled) {
      return this.putToCos(key, content);
    }
    const filePath = join(this.localDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return { key, url: `${this.cdnBase}/${key}` };
  }

  private async putToCos(key: string, _content: string): Promise<PutResult> {
    // TODO(M3): 接入 cos-nodejs-sdk-v5，配合 STS 临时密钥直传
    throw new Error(`COS 上传尚未实现：${key}`);
  }
}

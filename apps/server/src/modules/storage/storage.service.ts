import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CosService, IMMUTABLE_CACHE } from './cos.service';

export interface PutResult {
  key: string;
  url: string;
}

/**
 * 对象存储抽象。
 *
 * 配齐 COS 时写桶；否则写本地目录并由 /static 静态托管，让本地能完整跑通
 * 「发布 → 拿到 URL → 打开活动页」这条链路，不必先备齐云资源。调用方无感。
 *
 * 不需要 CDN 刷新：所有 key 都带内容哈希与版本号，回滚只切数据库里的指针，
 * CDN 上从来没有「同一个地址换了内容」的文件。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly localDir: string;
  private readonly cdnBase: string;
  private readonly cosEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly cos: CosService,
  ) {
    this.localDir = resolve(this.config.get<string>('PUBLISH_LOCAL_DIR', './.publish'));
    this.cosEnabled = cos.enabled;
    const configured = this.config.get<string>('CDN_BASE_URL');
    this.cdnBase = (configured || (this.cosEnabled ? cos.endpoint : 'http://localhost:3100/static')).replace(
      /\/$/,
      '',
    );
    if (!this.cosEnabled) {
      if (this.config.get<string>('COS_BUCKET')) {
        this.logger.warn('COS 配置不完整（需 COS_BUCKET / COS_REGION / COS_SECRET_ID / COS_SECRET_KEY），已回落本地存储');
      }
      this.logger.warn(`未配置 COS，发布产物写入本地目录 ${this.localDir}`);
    } else if (!configured) {
      this.logger.warn(`未配置 CDN_BASE_URL，产物地址直接使用桶域名 ${this.cdnBase}，上线前请换成 CDN 域名`);
    }
  }

  get usingCos(): boolean {
    return this.cosEnabled;
  }

  publicUrl(key: string): string {
    return `${this.cdnBase}/${key}`;
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
    return this.putBuffer(key, Buffer.from(content, 'utf8'), 'application/json');
  }

  async putBuffer(key: string, content: Buffer, contentType: string): Promise<PutResult> {
    if (this.cosEnabled) {
      await this.cos.putObject(key, content, contentType, IMMUTABLE_CACHE);
      return { key, url: this.publicUrl(key) };
    }
    const filePath = join(this.localDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return { key, url: this.publicUrl(key) };
  }
}

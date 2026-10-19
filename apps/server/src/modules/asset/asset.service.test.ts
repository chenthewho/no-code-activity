import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { AssetService } from './asset.service';

const HASH = 'a'.repeat(64);

interface AssetRow {
  id: string;
  url: string;
  hash: string | null;
  size: number;
  type: string;
}

function setup(
  options: { cosEnabled: boolean; headSize?: number; exists?: boolean } = { cosEnabled: true },
) {
  const rows: AssetRow[] = [];
  const prisma = {
    asset: {
      findFirst: vi.fn(
        async ({ where }: { where: { hash: string } }) =>
          rows.find((r) => r.hash === where.hash) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<AssetRow, 'id'> }) => {
        const row = { id: `as_${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
    },
  };
  const cos = {
    enabled: options.cosEnabled,
    createDirectUpload: vi.fn(async (key: string, contentType: string) => ({
      uploadUrl: `https://bucket/${key}`,
      method: 'PUT' as const,
      headers: { Authorization: 'sig', 'x-cos-security-token': 't', 'Content-Type': contentType },
      credentials: {
        tmpSecretId: 'a',
        tmpSecretKey: 'b',
        sessionToken: 't',
        startTime: 1,
        expiredTime: 2,
      },
      bucket: 'bucket',
      region: 'ap-guangzhou',
      key,
    })),
    headObject: vi.fn(async () => ({
      exists: options.exists ?? true,
      size: options.headSize ?? 2048,
    })),
  };
  const storage = { publicUrl: (key: string) => `https://cdn.test/${key}` };
  const redis = new RedisService({ get: () => undefined } as never);
  const config = { get: () => 900 };
  const service = new AssetService(
    prisma as never,
    storage as never,
    cos as never,
    redis,
    config as never,
  );
  return { service, rows, cos };
}

const ticketDto = { filename: 'a.png', mimetype: 'image/png', size: 2048, sha256: HASH };

describe('AssetService 直传', () => {
  it('签发凭证 → 确认对象到位 → 登记素材，地址取 CDN 根', async () => {
    const { service, rows, cos } = setup();
    const ticket = await service.createUploadTicket(ticketDto, 'u1');
    expect(ticket.mode).toBe('cos');
    if (ticket.mode !== 'cos') return;
    expect(cos.createDirectUpload).toHaveBeenCalledWith(`assets/aa/${HASH}.png`, 'image/png', 900);
    expect(ticket.url).toBe(`https://cdn.test/assets/aa/${HASH}.png`);

    const done = await service.completeUpload({ uploadId: ticket.uploadId }, 'u1');
    expect(done).toEqual({ url: ticket.url, id: 'as_1', reused: false });
    expect(rows[0]).toMatchObject({ hash: HASH, size: 2048, type: 'image' });
  });

  it('同内容已存在时直接复用，不签发凭证', async () => {
    const { service, cos } = setup();
    const first = await service.createUploadTicket(ticketDto, 'u1');
    if (first.mode === 'cos') await service.completeUpload({ uploadId: first.uploadId }, 'u1');
    const second = await service.createUploadTicket(ticketDto, 'u2');
    expect(second).toEqual({
      mode: 'reused',
      id: 'as_1',
      url: `https://cdn.test/assets/aa/${HASH}.png`,
    });
    expect(cos.createDirectUpload).toHaveBeenCalledTimes(1);
  });

  it('未配 COS 时指示前端走中转', async () => {
    const { service } = setup({ cosEnabled: false });
    expect(await service.createUploadTicket(ticketDto, 'u1')).toEqual({
      mode: 'proxy',
      maxBytes: 10 * 1024 * 1024,
    });
  });

  it('类型不在白名单、或超出直传上限时拒绝', async () => {
    const { service } = setup();
    await expect(
      service.createUploadTicket({ ...ticketDto, mimetype: 'text/html' }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createUploadTicket({ ...ticketDto, size: 300 * 1024 * 1024 }, 'u1'),
    ).rejects.toThrow(/200MB/);
  });

  it('对象没到桶里、大小对不上、换了个人确认，都不登记', async () => {
    const missing = setup({ cosEnabled: true, exists: false });
    const t1 = await missing.service.createUploadTicket(ticketDto, 'u1');
    if (t1.mode === 'cos') {
      await expect(missing.service.completeUpload({ uploadId: t1.uploadId }, 'u1')).rejects.toThrow(
        /尚未上传/,
      );
    }

    const wrongSize = setup({ cosEnabled: true, headSize: 1 });
    const t2 = await wrongSize.service.createUploadTicket(ticketDto, 'u1');
    if (t2.mode === 'cos') {
      await expect(
        wrongSize.service.completeUpload({ uploadId: t2.uploadId }, 'u1'),
      ).rejects.toThrow(/大小不一致/);
    }

    const other = setup();
    const t3 = await other.service.createUploadTicket(ticketDto, 'u1');
    if (t3.mode === 'cos') {
      await expect(other.service.completeUpload({ uploadId: t3.uploadId }, 'u2')).rejects.toThrow(
        /不属于/,
      );
    }
    expect(missing.rows.length + wrongSize.rows.length + other.rows.length).toBe(0);
  });

  it('凭证只能确认一次', async () => {
    const { service } = setup();
    const ticket = await service.createUploadTicket(ticketDto, 'u1');
    if (ticket.mode !== 'cos') return;
    await service.completeUpload({ uploadId: ticket.uploadId }, 'u1');
    await expect(service.completeUpload({ uploadId: ticket.uploadId }, 'u1')).rejects.toThrow(
      /无效或已过期/,
    );
  });
});

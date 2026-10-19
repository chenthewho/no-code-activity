import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { AssetService } from './asset.service';

const HASH = 'a'.repeat(64);

interface AssetRow {
  id: string;
  url: string;
  hash: string | null;
  hashVerified: boolean;
  uploadedBy: string;
  size: number;
  type: string;
}

interface Where {
  hash: string;
  hashVerified?: boolean;
  OR?: ({ hashVerified: boolean } | { uploadedBy: string })[];
}

/** 按 Prisma 的语义实现 findFirst 里用到的那几种条件 */
function matches(row: AssetRow, where: Where): boolean {
  if (row.hash !== where.hash) return false;
  if (where.hashVerified !== undefined && row.hashVerified !== where.hashVerified) return false;
  if (where.OR) {
    return where.OR.some((c) =>
      'hashVerified' in c ? row.hashVerified === c.hashVerified : row.uploadedBy === c.uploadedBy,
    );
  }
  return true;
}

function setup(
  head: { exists?: boolean; size?: number; contentType?: string } = {},
  cosEnabled = true,
) {
  const rows: AssetRow[] = [];
  const prisma = {
    asset: {
      findFirst: vi.fn(
        async ({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<AssetRow, 'id'> }) => {
        const row = { id: `as_${rows.length + 1}`, hashVerified: true, ...data };
        rows.push(row);
        return row;
      }),
    },
  };
  const cos = {
    enabled: cosEnabled,
    createDirectUpload: vi.fn(async (key: string, contentType: string) => ({
      uploadUrl: `https://bucket/${key}`,
      method: 'PUT' as const,
      headers: { Authorization: 'sig', 'x-cos-security-token': 't', 'Content-Type': contentType },
      expiresAt: 2,
      key,
    })),
    headObject: vi.fn(async () => ({
      exists: head.exists ?? true,
      size: head.size ?? 2048,
      contentType: head.contentType ?? 'image/png',
    })),
  };
  const storage = {
    publicUrl: (key: string) => `https://cdn.test/${key}`,
    putBuffer: vi.fn(async (key: string) => ({ key, url: `https://cdn.test/${key}` })),
  };
  const redis = new RedisService({ get: () => undefined } as never);
  const service = new AssetService(prisma as never, storage as never, cos as never, redis, {
    get: () => 900,
  } as never);
  return { service, rows, cos, storage };
}

const ticketDto = { filename: 'a.png', mimetype: 'image/png', size: 2048, sha256: HASH };

async function directUpload(service: AssetService, userId: string) {
  const ticket = await service.createUploadTicket(ticketDto, userId);
  if (ticket.mode !== 'cos') throw new Error(`expected cos ticket, got ${ticket.mode}`);
  return { ticket, done: await service.completeUpload({ uploadId: ticket.uploadId }, userId) };
}

describe('AssetService 直传', () => {
  it('签发凭证 → 确认对象到位 → 登记素材；每次直传落在自己的对象上', async () => {
    const { service, rows, cos } = setup();
    const { ticket, done } = await directUpload(service, 'u1');
    expect(ticket.key).toMatch(new RegExp(`^assets/direct/aa/${HASH}-[\\w-]+\\.png$`));
    expect(cos.createDirectUpload).toHaveBeenCalledWith(ticket.key, 'image/png', 900);
    expect(ticket).not.toHaveProperty('credentials');
    expect(done).toEqual({ url: `https://cdn.test/${ticket.key}`, id: 'as_1', reused: false });
    expect(rows[0]).toMatchObject({ hash: HASH, hashVerified: false, uploadedBy: 'u1' });
  });

  it('自己直传过的可以复用；别人直传的不复用（哈希是浏览器报的，不可信）', async () => {
    const { service } = setup();
    await directUpload(service, 'u1');
    expect((await service.createUploadTicket(ticketDto, 'u1')).mode).toBe('reused');
    const other = await service.createUploadTicket(ticketDto, 'u2');
    expect(other.mode).toBe('cos');
  });

  it('谎报哈希的直传毒害不了服务端中转：中转只复用服务端算过哈希的记录', async () => {
    const { service, storage } = setup();
    await directUpload(service, 'attacker');
    const file = {
      originalname: 'a.png',
      mimetype: 'image/png',
      size: 4,
      buffer: Buffer.from('real'),
    };
    const result = await service.upload(file, 'victim');
    expect(result.reused).toBe(false);
    expect(storage.putBuffer).toHaveBeenCalled();
  });

  it('服务端中转登记的记录（哈希已核实）任何人都能复用', async () => {
    const { service } = setup({}, false);
    const buffer = Buffer.from('png-bytes');
    const sha = (await import('node:crypto')).createHash('sha256').update(buffer).digest('hex');
    await service.upload(
      { originalname: 'a.png', mimetype: 'image/png', size: buffer.length, buffer },
      'u1',
    );
    expect(
      await service.createUploadTicket({ ...ticketDto, sha256: sha, size: buffer.length }, 'u2'),
    ).toMatchObject({
      mode: 'reused',
    });
  });

  it('未配 COS 时指示前端走中转', async () => {
    const { service } = setup({}, false);
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

  it('对象没到桶里、大小或类型对不上、换了个人确认，都不登记', async () => {
    const cases = [
      { head: { exists: false }, user: 'u1', error: /尚未上传/ },
      { head: { size: 1 }, user: 'u1', error: /大小不一致/ },
      { head: { contentType: 'text/html' }, user: 'u1', error: /类型不一致/ },
      { head: {}, user: 'u2', error: /不属于/ },
    ];
    for (const c of cases) {
      const { service, rows } = setup(c.head);
      const ticket = await service.createUploadTicket(ticketDto, 'u1');
      if (ticket.mode !== 'cos') throw new Error('expected cos');
      await expect(service.completeUpload({ uploadId: ticket.uploadId }, c.user)).rejects.toThrow(
        c.error,
      );
      expect(rows).toHaveLength(0);
    }
  });

  it('凭证只能确认一次', async () => {
    const { service } = setup();
    const { ticket } = await directUpload(service, 'u1');
    await expect(service.completeUpload({ uploadId: ticket.uploadId }, 'u1')).rejects.toThrow(
      /无效或已过期/,
    );
  });
});

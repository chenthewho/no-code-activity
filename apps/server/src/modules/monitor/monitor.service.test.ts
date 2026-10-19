import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from '../../common/redis/redis.service';
import { buildWebhookBody, sendWebhook } from './alert.notifier';
import { MonitorService, formatMetric, metricValue, type WindowStats } from './monitor.service';

const EMPTY: WindowStats = {
  attempts: 0,
  boots: 0,
  loadErrors: 0,
  dslInvalid: 0,
  stalls: 0,
  whiteScreens: 0,
  jsErrors: 0,
  publishInvalid: 0,
};

describe('指标口径', () => {
  it('比率以「访问次数」为分母；卡住没渲染出来也算白屏', () => {
    const stats = {
      ...EMPTY,
      attempts: 200,
      boots: 190,
      dslInvalid: 4,
      stalls: 2,
      whiteScreens: 3,
      loadErrors: 4,
    };
    expect(metricValue('dsl_invalid_rate', stats)).toMatchObject({ value: 0.02, samples: 200 });
    expect(metricValue('white_screen_rate', stats).value).toBeCloseTo(0.025);
    expect(metricValue('load_error_rate', stats).value).toBe(0.02);
    expect(metricValue('dsl_invalid_rate', EMPTY).value).toBe(0);
    expect(formatMetric('white_screen_rate', 0.025)).toBe('2.50%');
    expect(formatMetric('js_error_count', 51)).toBe('51');
  });
});

function setup(counts: Record<string, number>, rule: Partial<Record<string, unknown>> = {}) {
  const records: unknown[] = [];
  const prisma = {
    monitorEvent: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) =>
        by[0] === 'type'
          ? Object.entries(counts).map(([type, n]) => ({ type, _count: { _all: n } }))
          : [{ activityId: 'act_bad', _count: { _all: 7 } }],
      ),
    },
    activity: { findUnique: vi.fn(async () => ({ title: '国庆抽奖' })) },
    alertRecord: { create: vi.fn((args: unknown) => (records.push(args), args)) },
    alertRule: { update: vi.fn((args: unknown) => args) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const service = new MonitorService(
    prisma as never,
    new RedisService({ get: () => undefined } as never),
    { get: () => 'https://admin.test' } as never,
  );
  const baseRule = {
    id: 'r1',
    name: '白屏率过高',
    metric: 'white_screen_rate',
    threshold: 0.05,
    windowMinutes: 10,
    minSamples: 20,
    cooldownMinutes: 30,
    enabled: true,
    webhookType: 'none',
    webhookUrl: null,
    lastTriggeredAt: null,
    ...rule,
  };
  return { service, prisma, records, rule: baseRule as never };
}

afterEach(() => vi.unstubAllGlobals());

describe('MonitorService.evaluateRule', () => {
  it('超过阈值且样本足够时告警，并指出问题最集中的活动', async () => {
    const empty = setup({});
    expect(await empty.service.evaluateRule(empty.rule)).toBe(false);

    // 98 次渲染成功 + 2 次卡住 = 100 次访问；白屏 8 + 卡住 2 = 10%
    const ctx = setup({ boot: 98, white_screen: 8, stall: 2 });
    expect(await ctx.service.evaluateRule(ctx.rule)).toBe(true);
    const created = (
      ctx.records[0] as { data: { message: string; activityId: string; notified: boolean } }
    ).data;
    expect(created.activityId).toBe('act_bad');
    expect(created.message).toMatch(/白屏率 10\.00%，阈值 5\.00%/);
    expect(created.message).toMatch(/国庆抽奖（7 次）/);
    // 没配通知地址：照样记录，只是不推送
    expect(created.notified).toBe(false);
  });

  it('样本不足、未超阈值、冷却期内都不告警', async () => {
    const few = setup({ boot: 5, white_screen: 5 });
    expect(await few.service.evaluateRule(few.rule)).toBe(false);
    const ok = setup({ boot: 990, white_screen: 10 });
    expect(await ok.service.evaluateRule(ok.rule)).toBe(false);
    const cooling = setup(
      { boot: 90, white_screen: 10 },
      { lastTriggeredAt: new Date(Date.now() - 5 * 60_000) },
    );
    expect(await cooling.service.evaluateRule(cooling.rule)).toBe(false);
  });

  it('计数类指标不看样本数；通知失败也照样留下告警记录', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ errcode: 93000, errmsg: 'invalid webhook' })),
      ),
    );
    const ctx = setup(
      { js_error: 60 },
      {
        metric: 'js_error_count',
        threshold: 50,
        minSamples: 1000,
        webhookType: 'wecom',
        webhookUrl: 'https://qyapi.test/hook',
      },
    );
    expect(await ctx.service.evaluateRule(ctx.rule)).toBe(true);
    const created = (ctx.records[0] as { data: { notified: boolean; notifyError: string } }).data;
    expect(created.notified).toBe(false);
    expect(created.notifyError).toMatch(/93000/);
  });
});

describe('告警通知', () => {
  const message = {
    title: '【活动页告警】白屏率过高',
    lines: ['近 10 分钟白屏率 8%'],
    link: 'https://admin.test/monitor',
  };

  it('按机器人类型拼消息体', () => {
    expect(buildWebhookBody('wecom', message)).toMatchObject({ msgtype: 'markdown' });
    expect(buildWebhookBody('dingtalk', message)).toMatchObject({
      msgtype: 'markdown',
      markdown: { title: message.title },
    });
    expect(buildWebhookBody('feishu', message)).toEqual({
      msg_type: 'text',
      content: {
        text: '【活动页告警】白屏率过高\n近 10 分钟白屏率 8%\nhttps://admin.test/monitor',
      },
    });
  });

  it('机器人返回 200 但 code 非 0 视为失败', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ code: 0 })));
    await expect(sendWebhook('https://x', 'feishu', message, ok as never)).resolves.toBeUndefined();
    const bad = vi.fn(
      async () => new Response(JSON.stringify({ code: 19001, msg: 'param invalid' })),
    );
    await expect(sendWebhook('https://x', 'feishu', message, bad as never)).rejects.toThrow(
      /19001/,
    );
  });
});

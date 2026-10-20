import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema, type FinalDsl } from '@nca/dsl';
import type { AppointmentSceneView } from '@nca/shared';
import { formatSceneTime } from '@nca/materials';
import { RendererSurface } from './RendererSurface';
import { resetAuthState } from '../runtime/auth';

function dsl(props: Record<string, unknown>, events: unknown[] = []): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.0.0',
    meta: { activityId: 'act_apt', title: '预约' },
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: ['apt'] },
      apt: { type: { resolvedName: 'Appointment' }, props },
    },
    events,
  });
}

const scene = (over: Partial<AppointmentSceneView>): AppointmentSceneView => ({
  sceneId: 's1',
  name: '上午场',
  capacity: 10,
  remaining: 3,
  status: 'open',
  booked: false,
  ...over,
});

/** 服务端：场次列表按调用次数返回不同结果（约完之后重拉看到的是新状态） */
function mockServer(lists: AppointmentSceneView[][]) {
  const calls: { url: string; body?: unknown }[] = [];
  let listCall = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/appointment-scenes')) {
        const list = lists[Math.min(listCall++, lists.length - 1)];
        return new Response(JSON.stringify(list), { status: 200 });
      }
      if (url.includes('/runtime/appointment')) {
        return new Response(JSON.stringify({ booked: true, already: false }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
  return calls;
}

beforeEach(() => resetAuthState());
afterEach(() => vi.unstubAllGlobals());

describe('预约场次', () => {
  it('列表模式：每场显示剩余名额与状态，约满 / 截止 / 已约的按钮不可点', async () => {
    mockServer([
      [
        scene({ sceneId: 's1', name: '上午场', remaining: 3 }),
        scene({ sceneId: 's2', name: '下午场', remaining: 0, status: 'full' }),
        scene({ sceneId: 's3', name: '晚场', status: 'closed' }),
        scene({ sceneId: 's4', name: '加场', booked: true }),
      ],
    ]);
    render(<RendererSurface dsl={dsl({ layout: 'list' })} />);

    const row = (name: string) => screen.getByText(name).closest('.nca-appointment__scene') as HTMLElement;
    await waitFor(() => expect(screen.getByText('上午场')).toBeInTheDocument());
    expect(within(row('上午场')).getByText('余 3')).toBeInTheDocument();
    expect(within(row('上午场')).getByRole('button', { name: '预约' })).toBeEnabled();
    expect(within(row('下午场')).getByRole('button', { name: '已约满' })).toBeDisabled();
    expect(within(row('晚场')).getByRole('button', { name: '已截止' })).toBeDisabled();
    expect(within(row('加场')).getByRole('button', { name: '已预约' })).toBeDisabled();
  });

  it('点击即预约（不用绑动作），约完重拉场次，按钮变成已预约', async () => {
    const calls = mockServer([[scene({})], [scene({ booked: true, remaining: 2 })]]);
    render(<RendererSurface dsl={dsl({ layout: 'list' })} />);

    fireEvent.click(await screen.findByRole('button', { name: '预约' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '已预约' })).toBeDisabled());
    const booking = calls.filter((c) => c.url.endsWith('/runtime/appointment'));
    expect(booking).toHaveLength(1);
    expect(booking[0]!.body).toMatchObject({ activityId: 'act_apt', sceneId: 's1' });
    expect(calls.filter((c) => c.url.includes('/appointment-scenes'))).toHaveLength(2);
  });

  it('运营自己绑了预约动作的以绑定为准，一次点击只约一遍', async () => {
    const calls = mockServer([[scene({ sceneId: 'scene_default' })]]);
    render(
      <RendererSurface
        dsl={dsl({ sceneId: 'scene_default' }, [
          {
            id: 'e1',
            nodeId: 'apt',
            trigger: 'onCustom',
            customEvent: 'appointment',
            actions: [{ type: 'appointment', sceneId: 'scene_default' }],
          },
        ])}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '立即预约' }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/runtime/appointment'))).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.url.endsWith('/runtime/appointment'))).toHaveLength(1);
  });

  it('单个场次模式：按 sceneId 找到自己的场次，显示时间与剩余名额', async () => {
    const startAt = new Date(2026, 9, 25, 14, 0).toISOString();
    const endAt = new Date(2026, 9, 25, 15, 30).toISOString();
    mockServer([[scene({ sceneId: 'vip', startAt, endAt, remaining: 5 })]]);
    render(<RendererSurface dsl={dsl({ sceneId: 'vip', sceneName: 'VIP 场' })} />);
    expect(await screen.findByText('剩余 5 个名额')).toBeInTheDocument();
    expect(screen.getByText('10月25日 14:00–15:30')).toBeInTheDocument();
  });

  it('时间格式：同一天合并、跨天写全、只有一头', () => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
    expect(formatSceneTime(at(25, 9), at(26, 10))).toBe('10月25日 09:00 – 10月26日 10:00');
    expect(formatSceneTime(at(25, 9))).toBe('10月25日 09:00 开始');
    expect(formatSceneTime(undefined, at(25, 18))).toBe('截至 10月25日 18:00');
    expect(formatSceneTime()).toBe('');
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema, type FinalDsl } from '@nca/dsl';

/**
 * C 端登录闭环：票据换 token → user 命名空间 → 业务接口带 token →
 * 服务端要求登录时拉起宿主登录并重试。
 *
 * restoreLogin 在模块级只跑一次，每个用例都重新加载模块拿一份干净的。
 */
async function loadSurface() {
  vi.resetModules();
  return (await import('../components/RendererSurface')).RendererSurface;
}

function makeDsl(events: unknown[] = []): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.1.0',
    meta: { activityId: 'act_auth', title: '登录测试', auth: { loginMode: 'sso' } },
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: ['who', 'btn'], props: {} },
      who: {
        type: { resolvedName: 'Text' },
        props: { content: '{{ user.loggedIn ? "你好 " + user.nickname : "未登录" }}' },
      },
      btn: { type: { resolvedName: 'Button' }, props: { text: '操作' } },
    },
    events,
  });
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__NCA_HOST__;
  delete window.__NCA_BRIDGE__;
});

describe('C 端登录', () => {
  it('SSO 回跳的票据换成 token，地址栏随即抹掉票据，user 命名空间可用', async () => {
    window.history.replaceState(null, '', '/?id=act_auth&nca_ticket=t_1');
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/runtime/auth/exchange')) {
        return jsonResponse(200, {
          token: 'rt_token',
          user: { id: 'u1', provider: 'sso', nickname: '小明' },
        });
      }
      return jsonResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const RendererSurface = await loadSurface();
    render(<RendererSurface dsl={makeDsl()} />);

    expect(await screen.findByText('你好 小明')).toBeInTheDocument();
    expect(window.location.search).toBe('?id=act_auth');
    expect(localStorage.getItem('nca:rt-token')).toBe('rt_token');
    const exchangeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/exchange'));
    expect(JSON.parse(String((exchangeCall?.[1] as RequestInit).body))).toEqual({ ticket: 't_1' });
  });

  it('服务端要求登录时拉起宿主登录，用 code 换 token 后带着 token 重试', async () => {
    window.__NCA_HOST__ = 'sdk_portrait';
    window.__NCA_BRIDGE__ = { login: vi.fn(async () => ({ code: 'host_code' })) };

    let booked = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/runtime/appointment')) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers.Authorization) {
          return jsonResponse(401, { message: '请先登录', reason: 'LOGIN_REQUIRED' });
        }
        booked += 1;
        return jsonResponse(200, { booked: true, already: false });
      }
      if (url.endsWith('/runtime/auth/host-login')) {
        return jsonResponse(200, {
          token: 'host_token',
          user: { id: 'u2', provider: 'sdk_portrait', nickname: '玩家' },
        });
      }
      return jsonResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const RendererSurface = await loadSurface();
    render(
      <RendererSurface
        dsl={makeDsl([
          {
            id: 'e1',
            nodeId: 'btn',
            trigger: 'onClick',
            actions: [{ type: 'appointment', sceneId: 's1' }],
          },
        ])}
      />,
    );
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: '操作' }));

    expect(await screen.findByText('预约成功')).toBeInTheDocument();
    expect(booked).toBe(1);
    expect(window.__NCA_BRIDGE__?.login).toHaveBeenCalledTimes(1);
    const hostCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/host-login'));
    expect(JSON.parse(String((hostCall?.[1] as RequestInit).body))).toEqual({
      host: 'sdk_portrait',
      code: 'host_code',
    });
    expect(screen.getByText('你好 玩家')).toBeInTheDocument();
  });

  it('宿主只报 userId（旧协议）时不算登录，仅作访客标识', async () => {
    window.__NCA_HOST__ = 'game_center';
    window.__NCA_BRIDGE__ = { login: vi.fn(async () => ({ userId: 'legacy_1' })) };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, {})),
    );

    const RendererSurface = await loadSurface();
    render(
      <RendererSurface
        dsl={makeDsl([
          { id: 'e1', nodeId: 'btn', trigger: 'onClick', actions: [{ type: 'login' }] },
        ])}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    await act(async () => {});

    expect(screen.getByText('未登录')).toBeInTheDocument();
    expect(localStorage.getItem('nca:rt-token')).toBeNull();
  });

  it('退出登录清掉本地 token，页面回到未登录态', async () => {
    localStorage.setItem('nca:rt-token', 'old_token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/runtime/auth/me')
          ? jsonResponse(200, { id: 'u3', provider: 'sso', nickname: '老用户' })
          : jsonResponse(200, {}),
      ),
    );

    const RendererSurface = await loadSurface();
    render(
      <RendererSurface
        dsl={makeDsl([
          { id: 'e1', nodeId: 'btn', trigger: 'onClick', actions: [{ type: 'logout' }] },
        ])}
      />,
    );
    expect(await screen.findByText('你好 老用户')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    await waitFor(() => expect(screen.getByText('未登录')).toBeInTheDocument());
    expect(localStorage.getItem('nca:rt-token')).toBeNull();
  });

  it('本地 token 已失效（401）时静默清掉，按未登录渲染', async () => {
    localStorage.setItem('nca:rt-token', 'expired');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { message: '未登录' })),
    );

    const RendererSurface = await loadSurface();
    render(<RendererSurface dsl={makeDsl()} />);
    await act(async () => {});

    expect(screen.getByText('未登录')).toBeInTheDocument();
    expect(localStorage.getItem('nca:rt-token')).toBeNull();
  });
});

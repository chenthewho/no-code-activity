import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DslAction, FinalDsl } from '@nca/dsl';
import type { AppointmentSceneView, RuntimeUserProfile } from '@nca/shared';
import type { ExpressionContext } from './expression';
import { resolveCondition, resolveValue } from './props-parser';
import {
  fetchDataSource,
  initDataSourceState,
  toExpressionData,
  type DataSourceMap,
} from './datasource';
import { detectHost } from './host/browser';
import {
  bookAppointment,
  drawLottery,
  fetchAppointmentScenes,
  getOrCreateGuestId,
  submitForm,
} from './api';
import {
  LoginRequiredError,
  clearRuntimeToken,
  exchangeTicket,
  hostLogin,
  restoreLogin,
} from './auth';
import { initAnalytics, trackAnalytics } from './analytics';
import { reportMonitor } from './monitor';
import { ROOT_NODE_ID } from '@nca/shared';
import type { HostAdapter } from './host/types';

export interface ToastItem {
  id: number;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

interface RuntimeValue {
  dsl: FinalDsl;
  editing: boolean;
  host: HostAdapter;
  /** C 端登录用户，未登录为 null */
  user: RuntimeUserProfile | null;
  pageState: Record<string, unknown>;
  dataSources: DataSourceMap;
  openModals: string[];
  toasts: ToastItem[];
  /** 后台配置的预约场次；页面上没有预约组件或还没加载到时为 null */
  appointmentScenes: AppointmentSceneView[] | null;
  /** 组件抛事件的统一入口，由 CanvasRenderer 绑到每个节点上 */
  emit: (nodeId: string, event: string, payload?: Record<string, unknown>) => void;
  buildContext: (scope?: Record<string, unknown>) => ExpressionContext;
  closeModal: (modalId?: string) => void;
}

const RuntimeContext = createContext<RuntimeValue | null>(null);

export function useRuntime(): RuntimeValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useRuntime 必须在 RuntimeProvider 内使用');
  return value;
}

/**
 * 表达式里的 user 命名空间。未登录时也给全字段（空串），
 * 运营写 {{ user.nickname }} 不会在未登录时渲染出 undefined。
 */
function toUserContext(user: RuntimeUserProfile | null) {
  return {
    loggedIn: Boolean(user),
    id: user?.id ?? '',
    nickname: user?.nickname ?? '',
    avatar: user?.avatar ?? '',
    provider: user?.provider ?? '',
  };
}

export interface RuntimeProviderProps {
  dsl: FinalDsl;
  /** 设计器预览态：关闭跳转、下载等有副作用的动作 */
  editing?: boolean;
  /**
   * 编辑态下要展开的弹窗。
   * 编辑态里组件的点击被交互层拦下了，`modal.open` 动作根本不会触发，
   * 所以弹窗的显隐只能由设计器指定，而不是靠运行时状态自己攒出来。
   */
  editingModalId?: string | null;
  children: ReactNode;
}

export function RuntimeProvider({
  dsl,
  editing = false,
  editingModalId = null,
  children,
}: RuntimeProviderProps) {
  const host = useMemo(() => detectHost(), []);
  const [pageState, setPageState] = useState<Record<string, unknown>>(() => ({
    ...dsl.initialState,
  }));
  const [dataSources, setDataSources] = useState<DataSourceMap>(() =>
    initDataSourceState(dsl.dataSources),
  );
  const [openModals, setOpenModals] = useState<string[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const [appointmentScenes, setAppointmentScenes] = useState<AppointmentSceneView[] | null>(null);
  const [user, setUser] = useState<RuntimeUserProfile | null>(null);
  // 同 ctxRef：动作是异步串行的，登录完成后紧随其后的动作要立刻读到新用户
  const userRef = useRef<RuntimeUserProfile | null>(null);
  /** 旧协议宿主自报的 userId，只当访客标识，不算登录 */
  const legacyIdRef = useRef<string | null>(null);
  /** 启动时的登录态恢复；业务动作先等它，避免刚回跳就以访客身份抽了一次奖 */
  const authReadyRef = useRef<Promise<unknown>>(Promise.resolve());
  /** 进行中的登录，连点两次「登录」只拉起一次 */
  const loginRef = useRef<Promise<RuntimeUserProfile | null> | null>(null);
  // runAction 先于 emit 定义，component.trigger 又要调 emit——用 ref 绕开循环依赖
  const emitRef = useRef<(nodeId: string, event: string, payload?: Record<string, unknown>) => void>(() => {});

  const query = useMemo(() => {
    if (typeof window === 'undefined') return {};
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }, []);

  // 表达式上下文放进 ref：动作执行是异步的，直接闭包会读到过期的 state
  const ctxRef = useRef<{
    pageState: Record<string, unknown>;
    dataSources: DataSourceMap;
  }>({ pageState, dataSources });
  ctxRef.current = { pageState, dataSources };

  const buildContext = useCallback(
    (scope?: Record<string, unknown>): ExpressionContext => ({
      state: ctxRef.current.pageState,
      dataSource: toExpressionData(ctxRef.current.dataSources),
      meta: dsl.meta,
      query,
      // 宿主标识：同一 DSL 可在不同宿主上按 {{ host === 'sdk_portrait' }} 分支
      host: host.type,
      user: toUserContext(userRef.current),
      ...scope,
    }),
    [dsl.meta, host, query],
  );

  const pushToast = useCallback((message: string, level: ToastItem['level'], duration: number) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, level }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const commitUser = useCallback((next: RuntimeUserProfile | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  /**
   * 确保已登录：已登录直接返回；否则交给宿主拉起登录，拿回的 code/票据
   * 一律到服务端换 C 端 token。返回 null 表示没登上（宿主不支持、正在整页跳转）。
   */
  const ensureLogin = useCallback(async (): Promise<RuntimeUserProfile | null> => {
    await authReadyRef.current;
    if (userRef.current) return userRef.current;
    loginRef.current ??= (async () => {
      try {
        const result = await host.login();
        if (!result) {
          pushToast('当前环境暂不支持登录', 'warning', 2500);
          return null;
        }
        if (result.redirecting) return null;
        let profile: RuntimeUserProfile | null = null;
        if (result.ticket) profile = await exchangeTicket(result.ticket, host.type);
        else if (result.code) profile = await hostLogin(host.type, result.code);
        else if (result.userId) legacyIdRef.current = result.userId;
        if (profile) commitUser(profile);
        return profile;
      } catch (err) {
        console.error('[nca] 登录失败', err);
        pushToast(err instanceof Error ? err.message : '登录失败', 'error', 3000);
        return null;
      } finally {
        loginRef.current = null;
      }
    })();
    return loginRef.current;
  }, [commitUser, host, pushToast]);

  /**
   * 以「当前参与者」身份调业务接口。登录用户靠请求头里的 token 识别，
   * 这里传的只是访客标识；服务端判定该活动必须登录时拉起登录，登上后重试一次。
   */
  const withParticipant = useCallback(
    async <T,>(call: (guestId: string) => Promise<T>): Promise<T> => {
      await authReadyRef.current;
      const guestId = legacyIdRef.current ?? getOrCreateGuestId();
      try {
        return await call(guestId);
      } catch (err) {
        if (!(err instanceof LoginRequiredError)) throw err;
        const profile = await ensureLogin();
        if (!profile) throw err;
        return call(guestId);
      }
    },
    [ensureLogin],
  );

  const closeModal = useCallback((modalId?: string) => {
    setOpenModals((prev) => (modalId ? prev.filter((id) => id !== modalId) : prev.slice(0, -1)));
  }, []);

  /**
   * 状态写入必须同步落到 ctxRef：一个事件里的多个动作是串行 await 的，
   * 而 React 不会在两个 await 之间重渲染。只调 setState 的话，
   * 紧随其后的动作仍会读到这次写入之前的值。
   */
  const commitPageState = useCallback((key: string, value: unknown) => {
    ctxRef.current = {
      ...ctxRef.current,
      pageState: { ...ctxRef.current.pageState, [key]: value },
    };
    setPageState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const refreshDataSource = useCallback(
    async (dataSourceId: string) => {
      const ds = dsl.dataSources.find((d) => d.id === dataSourceId);
      if (!ds) return;
      setDataSources((prev) => ({ ...prev, [ds.id]: { ...prev[ds.id]!, loading: true } }));
      const next = await fetchDataSource(ds, buildContext());
      // 同 commitPageState：「刷新数据源 → 把结果写进 state」是标准编排，
      // 后一个动作必须能立刻读到这次的返回值
      ctxRef.current = {
        ...ctxRef.current,
        dataSources: { ...ctxRef.current.dataSources, [ds.id]: next },
      };
      setDataSources((prev) => ({ ...prev, [ds.id]: next }));
    },
    [dsl.dataSources, buildContext],
  );

  // 预约场次的名额与「我约过没有」是运行时数据：页面上有预约组件才拉，约完重拉
  const hasAppointment = useMemo(
    () => Object.values(dsl.craftJson).some((node) => node.type.resolvedName === 'Appointment'),
    [dsl.craftJson],
  );
  const refreshAppointments = useCallback(async () => {
    if (!hasAppointment || !dsl.meta.activityId) return;
    try {
      setAppointmentScenes(await fetchAppointmentScenes(dsl.meta.activityId));
    } catch (err) {
      console.warn('[nca] 预约场次加载失败', err);
    }
  }, [dsl.meta.activityId, hasAppointment]);

  const runAction = useCallback(
    async (action: DslAction, scope?: Record<string, unknown>): Promise<void> => {
      const ctx = buildContext(scope);
      if (!resolveCondition(action.condition, ctx)) return;

      switch (action.type) {
        case 'navigate':
          if (editing) {
            pushToast('预览态不执行页面跳转', 'info', 2000);
            return;
          }
          host.navigate(action.url, action.target);
          return;

        case 'modal.open':
          setOpenModals((prev) =>
            prev.includes(action.modalId) ? prev : [...prev, action.modalId],
          );
          return;

        case 'modal.close':
          closeModal(action.modalId);
          return;

        case 'toast':
          pushToast(action.message, action.level, action.duration);
          return;

        case 'state.set':
          // value 允许写 {{ }}：不求值的话，「把接口返回的中奖下标写进 state」
          // 这类最基本的编排根本无法表达，只会存进一个字面量字符串
          commitPageState(action.key, resolveValue(action.value, ctx));
          return;

        case 'dataSource.refresh':
          await refreshDataSource(action.dataSourceId);
          return;

        case 'share': {
          const result = await host.share(action);
          if (result?.hint) pushToast(result.hint, 'info', 2500);
          return;
        }

        case 'game.download':
          if (editing) {
            pushToast('预览态不执行下载', 'info', 2000);
            return;
          }
          {
            const result = await host.downloadGame(action.gameId);
            if (result?.hint) pushToast(result.hint, 'info', 2500);
          }
          return;

        case 'login':
          if (editing) {
            pushToast('预览态不执行登录', 'info', 2000);
            return;
          }
          await ensureLogin();
          return;

        case 'logout':
          if (editing) return;
          clearRuntimeToken();
          legacyIdRef.current = null;
          commitUser(null);
          await host.logout?.();
          return;

        case 'sdk.invoke':
          try {
            await host.invoke(action.method, action.params);
          } catch (err) {
            console.warn('[nca] SDK 调用失败', err);
          }
          return;

        // 抽奖：调服务端接口，把返回的下标写进 state，物料按它落停并 emit finish
        case 'lottery.draw': {
          if (editing) {
            pushToast('预览态不执行抽奖', 'info', 2000);
            return;
          }
          const activityId = dsl.meta.activityId;
          try {
            const result = await withParticipant((guestId) => drawLottery(activityId, guestId));
            if (result.won) {
              commitPageState('prizeIndex', result.index);
              commitPageState('prizeResult', result.prize);
              trackAnalytics('convert', (ctx as { nodeId?: string }).nodeId, { type: 'lottery' });
            } else {
              // 未中奖：置 -1 让物料转满 timeout 后发 timeout，运营可绑「谢谢参与」提示
              commitPageState('prizeIndex', -1);
              commitPageState('prizeResult', null);
            }
          } catch (err) {
            // 没登上的情况登录流程自己已经提示过（或正在跳转登录页），不再叠一条
            if (!(err instanceof LoginRequiredError)) {
              console.error('[nca] 抽奖失败', err);
              pushToast(err instanceof Error ? err.message : '抽奖失败', 'error', 3000);
            }
            commitPageState('prizeIndex', -1);
          }
          return;
        }

        // 表单提交：Form 物料在 submit 事件里把 { values } 带进 payload，
        // 这里取出来上报，成功/失败用 toast 提示运营
        case 'form.submit': {
          if (editing) {
            pushToast('预览态不提交表单', 'info', 2000);
            return;
          }
          const formNodeId = resolveValue(action.formNodeId, ctx) as string;
          const values = (ctx.payload as { values?: Record<string, unknown> })?.values;
          if (!formNodeId || !values) {
            pushToast('表单数据不完整，请检查事件绑定', 'warning', 3000);
            return;
          }
          const activityId = dsl.meta.activityId;
          try {
            await withParticipant((guestId) =>
              submitForm({ activityId, formNodeId, userId: guestId, data: values }),
            );
            trackAnalytics('convert', (ctx as { nodeId?: string }).nodeId, { type: 'form' });
            pushToast('提交成功', 'success', 2500);
          } catch (err) {
            if (err instanceof LoginRequiredError) return;
            console.error('[nca] 表单提交失败', err);
            pushToast(err instanceof Error ? err.message : '提交失败', 'error', 3000);
          }
          return;
        }

        // 活动预约：一人一场次一次。场次 id 优先取物料 payload，其次取动作配置
        case 'appointment': {
          if (editing) {
            pushToast('预览态不预约', 'info', 2000);
            return;
          }
          const payload = (ctx.payload as { sceneId?: string }) ?? {};
          const sceneId = payload.sceneId || action.sceneId;
          if (!sceneId) {
            pushToast('缺少场次 sceneId，请检查绑定', 'warning', 3000);
            return;
          }
          const activityId = dsl.meta.activityId;
          try {
            const result = await withParticipant((guestId) =>
              bookAppointment({ activityId, sceneId, userId: guestId }),
            );
            if (!result.already) {
              trackAnalytics('convert', (ctx as { nodeId?: string }).nodeId, { type: 'appointment' });
            }
            pushToast(
              result.already ? '你已预约过该场次' : '预约成功',
              result.already ? 'warning' : 'success',
              2500,
            );
          } catch (err) {
            if (err instanceof LoginRequiredError) return;
            console.error('[nca] 预约失败', err);
            pushToast(err instanceof Error ? err.message : '预约失败', 'error', 3000);
          }
          // 成功、约满、已截止都重拉一次，让按钮和剩余名额跟上服务端
          void refreshAppointments();
          return;
        }

        // 向指定节点派发自定义事件：触发该节点上绑定的 onCustom/onX 动作，
        // 用于「点 A 按钮去动 B 组件」这类跨组件编排
        case 'component.trigger': {
          const targetId = resolveValue(action.nodeId, ctx) as string;
          if (!targetId) {
            pushToast('缺少目标节点 nodeId，请检查绑定', 'warning', 3000);
            return;
          }
          emitRef.current?.(targetId, action.event, action.payload ? { ...action.payload } : undefined);
          return;
        }

        default:
          return;
      }
    },
    [
      buildContext,
      closeModal,
      commitPageState,
      commitUser,
      dsl.meta.activityId,
      editing,
      ensureLogin,
      host,
      pushToast,
      refreshAppointments,
      refreshDataSource,
      withParticipant,
    ],
  );

  const emit = useCallback(
    (nodeId: string, event: string, payload?: Record<string, unknown>) => {
      // 埋点：点击事件计入点击（编辑态不记）
      if (!editing && event === 'click') trackAnalytics('click', nodeId);

      // 弹窗关闭是物料内建行为，即使没配事件也要生效
      if (event === 'close' && dsl.craftJson[nodeId]?.type.resolvedName === 'Modal') {
        closeModal(nodeId);
      }

      const bindings = dsl.events.filter((binding) => {
        if (binding.nodeId !== nodeId) return false;
        if (binding.trigger === 'onCustom') return binding.customEvent === event;
        return binding.trigger.toLowerCase() === `on${event}`.toLowerCase();
      });

      // 预约是预约组件的内建行为：拖进来就能约，不必再绑「预约」动作。
      // 运营自己绑了预约动作的以绑定为准，免得一次点击约两遍
      if (
        event === 'appointment' &&
        dsl.craftJson[nodeId]?.type.resolvedName === 'Appointment' &&
        !bindings.some((binding) => binding.actions.some((action) => action.type === 'appointment'))
      ) {
        void runAction({ type: 'appointment', sceneId: '' }, { payload, nodeId });
      }

      for (const binding of bindings) {
        void (async () => {
          // 动作按声明顺序串行，「关弹窗 → 弹提示」这类编排才有确定次序
          for (const action of binding.actions) {
            // nodeId 随 scope 进动作上下文，供转化埋点知道是哪个组件
            await runAction(action, { payload, nodeId });
          }
        })();
      }
    },
    [closeModal, dsl.craftJson, dsl.events, editing, runAction],
  );
  // emit 就绪后回填到 ref，component.trigger 才能派发到任意节点
  emitRef.current = emit;

  // 恢复登录态：SSO 回跳的票据换 token，或用本地 token 取回用户。
  // 页面配置了「进页面即要求登录」时，恢复不出用户就立刻拉起登录。
  useEffect(() => {
    if (editing) return;
    const ready = restoreLogin(host.type).then((profile) => {
      if (profile) commitUser(profile);
    });
    authReadyRef.current = ready;
    void ready.then(() => {
      if (dsl.meta.auth.required && !userRef.current) void ensureLogin();
    });
  }, [commitUser, dsl.meta.auth.required, editing, ensureLogin, host.type]);

  // 投放宿主里没有当前宿主：多半是链接被转发到了没测过的环境，照常渲染但留下线索
  useEffect(() => {
    if (editing || dsl.meta.hosts.includes(host.type)) return;
    console.warn(`[nca] 当前宿主 ${host.type} 不在该活动的投放宿主 ${dsl.meta.hosts.join(', ')} 中`);
    reportMonitor('host_mismatch', { message: host.type, detail: { hosts: dsl.meta.hosts } });
  }, [dsl.meta.hosts, editing, host.type]);

  // 埋点初始化 + 页面曝光（PV）。只在真实浏览（非编辑预览）时记。
  useEffect(() => {
    const id = dsl.meta.activityId;
    if (!id || editing) return;
    initAnalytics(id);
    trackAnalytics('expose', ROOT_NODE_ID);
  }, [dsl.meta.activityId, editing]);

  /**
   * 自动加载数据源；轮询数据源按各自间隔独立计时。
   *
   * 引用了 user 的数据源（如 `{{ user.id }}` 拼进接口参数）要等登录态恢复完再拉，
   * 登录 / 退出后重拉一次；其余数据源不等，免得每个页面首屏都多等一次 /me。
   */
  const userId = user?.id ?? '';

  // 等登录态恢复完再拉预约场次：「我约过没有」按登录用户算；登录 / 退出后重拉
  useEffect(() => {
    void authReadyRef.current.then(refreshAppointments);
  }, [refreshAppointments, userId]);

  const dependsOnUser = useCallback((ds: FinalDsl['dataSources'][number]) => JSON.stringify(ds).includes('user.'), []);

  const startDataSources = useCallback(
    (sources: FinalDsl['dataSources'], forUser?: string) => {
      const controller = new AbortController();
      const timers: number[] = [];
      for (const ds of sources) {
        // 静态数据源在 initDataSourceState 里已就位，再跑一遍只会多一次无谓重渲染
        if (ds.type === 'static') continue;
        if (ds.type === 'http' && !ds.autoLoad) continue;

        const load = async () => {
          if (forUser !== undefined) {
            await authReadyRef.current;
            // 等待期间身份变了（启动时恢复出了登录用户）：这一轮作废，按新身份重跑的那轮会拉
            if ((userRef.current?.id ?? '') !== forUser) return;
          }
          if (controller.signal.aborted) return;
          const next = await fetchDataSource(ds, buildContext(), controller.signal);
          if (!controller.signal.aborted) {
            setDataSources((prev) => ({ ...prev, [ds.id]: next }));
          }
        };
        void load();

        if (ds.type === 'http' && ds.pollInterval > 0) {
          timers.push(window.setInterval(load, ds.pollInterval));
        }
      }
      return () => {
        controller.abort();
        timers.forEach((t) => window.clearInterval(t));
      };
    },
    [buildContext],
  );

  useEffect(
    () => startDataSources(dsl.dataSources.filter((ds) => !dependsOnUser(ds))),
    [dsl.dataSources, dependsOnUser, startDataSources],
  );

  useEffect(
    () => startDataSources(dsl.dataSources.filter(dependsOnUser), userId),
    // userId 变了（登录、退出）就按新身份重拉
    [dsl.dataSources, dependsOnUser, startDataSources, userId],
  );

  // 编辑态由设计器说了算，运行时才用动作攒出来的那份
  const visibleModals = useMemo(
    () => (editing ? (editingModalId ? [editingModalId] : []) : openModals),
    [editing, editingModalId, openModals],
  );

  const value = useMemo<RuntimeValue>(
    () => ({
      dsl,
      editing,
      host,
      user,
      pageState,
      dataSources,
      openModals: visibleModals,
      toasts,
      appointmentScenes,
      emit,
      buildContext,
      closeModal,
    }),
    [
      dsl,
      editing,
      host,
      user,
      pageState,
      dataSources,
      visibleModals,
      toasts,
      appointmentScenes,
      emit,
      buildContext,
      closeModal,
    ],
  );

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

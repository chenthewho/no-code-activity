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
import type { ExpressionContext } from './expression';
import { resolveCondition, resolveValue } from './props-parser';
import {
  fetchDataSource,
  initDataSourceState,
  toExpressionData,
  type DataSourceMap,
} from './datasource';
import { detectHost } from './host/browser';
import { drawLottery, getOrCreateGuestId } from './api';
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
  pageState: Record<string, unknown>;
  dataSources: DataSourceMap;
  openModals: string[];
  toasts: ToastItem[];
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
      ...scope,
    }),
    [dsl.meta, query],
  );

  const pushToast = useCallback((message: string, level: ToastItem['level'], duration: number) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, level }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

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

        case 'share':
          await host.share(action);
          return;

        case 'game.download':
          if (editing) {
            pushToast('预览态不执行下载', 'info', 2000);
            return;
          }
          await host.downloadGame(action.gameId);
          return;

        case 'login':
          await host.login();
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
          const userId = (await host.login())?.userId ?? getOrCreateGuestId();
          try {
            const result = await drawLottery(activityId, userId);
            if (result.won) {
              commitPageState('prizeIndex', result.index);
              commitPageState('prizeResult', result.prize);
            } else {
              // 未中奖：置 -1 让物料转满 timeout 后发 timeout，运营可绑「谢谢参与」提示
              commitPageState('prizeIndex', -1);
              commitPageState('prizeResult', null);
            }
          } catch (err) {
            console.error('[nca] 抽奖失败', err);
            pushToast(err instanceof Error ? err.message : '抽奖失败', 'error', 3000);
            commitPageState('prizeIndex', -1);
          }
          return;
        }

        // 以下动作依赖 M3 的其它业务接口，先明确提示而不是静默失败
        case 'appointment':
        case 'form.submit':
        case 'component.trigger':
          pushToast(`动作「${action.type}」尚未接入`, 'warning', 2000);
          return;

        default:
          return;
      }
    },
    [buildContext, closeModal, commitPageState, editing, host, pushToast, refreshDataSource],
  );

  const emit = useCallback(
    (nodeId: string, event: string, payload?: Record<string, unknown>) => {
      // 弹窗关闭是物料内建行为，即使没配事件也要生效
      if (event === 'close' && dsl.craftJson[nodeId]?.type.resolvedName === 'Modal') {
        closeModal(nodeId);
      }

      const bindings = dsl.events.filter((binding) => {
        if (binding.nodeId !== nodeId) return false;
        if (binding.trigger === 'onCustom') return binding.customEvent === event;
        return binding.trigger.toLowerCase() === `on${event}`.toLowerCase();
      });

      for (const binding of bindings) {
        void (async () => {
          // 动作按声明顺序串行，「关弹窗 → 弹提示」这类编排才有确定次序
          for (const action of binding.actions) {
            await runAction(action, payload ? { payload } : undefined);
          }
        })();
      }
    },
    [closeModal, dsl.craftJson, dsl.events, runAction],
  );

  // 自动加载数据源；轮询数据源按各自间隔独立计时
  useEffect(() => {
    const controller = new AbortController();
    const timers: number[] = [];

    for (const ds of dsl.dataSources) {
      // 静态数据源在 initDataSourceState 里已就位，再跑一遍只会多一次无谓重渲染
      if (ds.type === 'static') continue;
      if (ds.type === 'http' && !ds.autoLoad) continue;

      const load = async () => {
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
  }, [dsl.dataSources, buildContext]);

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
      pageState,
      dataSources,
      openModals: visibleModals,
      toasts,
      emit,
      buildContext,
      closeModal,
    }),
    [
      dsl,
      editing,
      host,
      pageState,
      dataSources,
      visibleModals,
      toasts,
      emit,
      buildContext,
      closeModal,
    ],
  );

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

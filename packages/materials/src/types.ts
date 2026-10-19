import type { ComponentType, ReactNode } from 'react';
import type { MaterialMeta } from '@nca/dsl';
import type { MaterialMigration } from './versioning';

/**
 * 渲染器注入给每个物料的运行时能力。
 *
 * 刻意用显式 props 而不是 React Context：物料因此不依赖 runtime-core，
 * 设计器可以脱离运行时单独渲染它们，单测也不需要套 Provider。
 */
export interface MaterialInjectedProps {
  /** 子节点。容器类物料负责决定把它放在哪 */
  children?: ReactNode;
  /** 当前节点 id */
  nodeId?: string;
  /** 具名插槽内容：slotName → 挂进该插槽的子节点（来自 craftNode.linkedNodes） */
  slotContent?: Record<string, ReactNode>;
  /** 抛出自定义事件给 EventBinder，事件名需在 meta.events 中声明过 */
  emit?: (event: string, payload?: Record<string, unknown>) => void;
  /** 设计器编辑态：物料据此关闭跳转、自动播放等副作用 */
  editing?: boolean;
}

export type MaterialComponentProps<P> = P & MaterialInjectedProps;

export interface MaterialDefinition<P = Record<string, unknown>> {
  meta: MaterialMeta;
  Component: ComponentType<MaterialComponentProps<P>>;
  /** 大版本升级时的 props 迁移，规则见 versioning.ts */
  migrations?: readonly MaterialMigration[];
}

/** 便于各物料文件定型，同时保证 meta 与组件 props 同源维护 */
export function defineMaterial<P>(def: MaterialDefinition<P>): MaterialDefinition<P> {
  return def;
}

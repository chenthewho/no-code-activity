import { z } from 'zod';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { jsonValue } from './primitives';

/**
 * 物料协议。propsSchema 是设置器面板的唯一数据来源——
 * 新增一个物料属性只改这里，设计器右侧表单自动长出对应控件，不写任何面板代码。
 */

export const propEditorType = z.enum([
  'string',
  'textarea',
  'richtext',
  'number',
  'boolean',
  'color',
  'image',
  'video',
  'url',
  'select',
  'radio',
  'spacing',
  'font',
  'json',
  'dataSource',
]);

export const propOptionSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const propSchemaItem = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  editor: propEditorType,
  /** 面板分组：属性 / 样式 / 事件三栏 */
  group: z.enum(['props', 'style', 'event']).default('props'),
  /**
   * 面板内的分区。设置器把样式项再拆成「基础样式」与「布局与间距」两块，
   * 靠字段名猜属于哪块太脆，索性在协议里说清楚。
   */
  section: z.enum(['basic', 'layout']).optional(),
  defaultValue: jsonValue.optional(),
  options: z.array(propOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  /** 是否允许填 {{ }} 表达式做数据绑定 */
  bindable: z.boolean().default(false),
  /** 该项在设置器中的显隐条件，如 "{{ props.mode === 'link' }}" */
  visibleWhen: z.string().optional(),
});

export type PropSchemaItem = z.infer<typeof propSchemaItem>;

export const materialEventDef = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  /** 事件回调携带的字段说明，供设计器提示可用变量 */
  payloadKeys: z.array(z.string()).default([]),
});

export const materialMetaSchema = z.object({
  /** 唯一标识，等于 craftNode.type.resolvedName 与 componentMap 的 key */
  name: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  category: z.enum([
    MATERIAL_CATEGORY.BASIC,
    MATERIAL_CATEGORY.CONTAINER,
    MATERIAL_CATEGORY.MEDIA,
    MATERIAL_CATEGORY.BUSINESS,
  ]),
  icon: z.string().optional(),
  description: z.string().optional(),
  /** 可作为画布容器接收子节点 */
  isContainer: z.boolean().default(false),
  /** 具名插槽列表，配合 craftNode.linkedNodes */
  slots: z.array(z.string()).default([]),
  propsSchema: z.array(propSchemaItem).default([]),
  events: z.array(materialEventDef).default([]),
  defaultProps: z.record(z.string(), jsonValue).default({}),
  /** 仅在这些宿主可用，缺省表示全部宿主可用 */
  supportedHosts: z.array(z.string()).optional(),
  /**
   * 已废弃：工具箱不再提供，已有节点照常渲染。物料的下线分两步——先废弃让
   * 新活动不再用它，等存量活动都下线了再从代码里删除。
   */
  deprecated: z
    .object({
      reason: z.string().optional(),
      /** 建议替换成哪个物料 */
      replacedBy: z.string().optional(),
    })
    .optional(),
});

export type MaterialMeta = z.infer<typeof materialMetaSchema>;

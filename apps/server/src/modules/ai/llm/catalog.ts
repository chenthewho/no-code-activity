import { materialMetaSchema, type MaterialMeta, type PropSchemaItem } from '@nca/dsl';
import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * 模型能用的物料清单。
 *
 * 数据取自 material 表而不是直接 import @nca/materials：
 * 一来那个包是 ESM + React，拉进 CJS 的服务端要把 React 一起拖进生产依赖；
 * 二来表里有 enabled 开关，运营临时下架的物料对模型也应该同时消失——
 * 否则 AI 会热情地推荐一个工具箱里根本找不到的组件。
 *
 * 清单本身随发版才变，是天然的缓存前缀。
 */
export interface MaterialCatalog {
  materials: MaterialMeta[];
  /** 传给 applyPatches / validateFinalDsl 的白名单 */
  names: ReadonlySet<string>;
  /** 可以接子节点的物料 */
  containers: ReadonlySet<string>;
  /** 物料名 → 当前版本，AI 新建的节点据此记下物料版本 */
  versions: Readonly<Record<string, string>>;
  /** 渲染好的说明书，直接塞进 system prompt */
  text: string;
}

/** 把一条 propsSchema 压成一行，够模型判断怎么填就行，不必还原整个表单协议 */
function renderProp(item: PropSchemaItem): string {
  const bits: string[] = [`  ${item.key}: ${item.editor}`];

  if (item.options?.length) {
    bits.push(`= ${item.options.map((o) => String(o.value)).join(' | ')}`);
  }
  if (typeof item.min === 'number' || typeof item.max === 'number') {
    bits.push(`[${item.min ?? ''}..${item.max ?? ''}]`);
  }
  if (item.bindable) bits.push('可绑定');
  if (item.visibleWhen) bits.push(`仅当 ${item.visibleWhen}`);
  bits.push(`— ${item.label}`);
  if (item.help) bits.push(`（${item.help}）`);
  return bits.join(' ');
}

function renderMaterial(meta: MaterialMeta): string {
  const lines: string[] = [];
  const kind = meta.isContainer ? '容器' : '叶子';
  lines.push(`### ${meta.name} — ${meta.title}（${meta.category} / ${kind}）`);
  if (meta.description) lines.push(meta.description);

  if (meta.events.length) {
    const events = meta.events
      .map((e) => {
        const payload = e.payloadKeys.length ? `(${e.payloadKeys.join(',')})` : '';
        return `${e.name}${payload}`;
      })
      .join('、');
    // 只有 click 能用 onClick，其余一律 onCustom + customEvent，这里顺手提醒
    lines.push(`事件：${events}`);
  }

  const props = meta.propsSchema.filter((p) => p.group === 'props');
  if (props.length) {
    lines.push('属性：');
    lines.push(...props.map(renderProp));
  }

  const defaults = Object.entries(meta.defaultProps);
  if (defaults.length) {
    // 有默认值的属性不用重复写，能省不少输出 token
    lines.push(`默认值：${JSON.stringify(meta.defaultProps)}`);
  }
  return lines.join('\n');
}

export async function loadMaterialCatalog(prisma: PrismaService): Promise<MaterialCatalog> {
  const rows = await prisma.material.findMany({
    where: { enabled: true },
    orderBy: [{ sort: 'asc' }, { name: 'asc' }],
  });

  const materials: MaterialMeta[] = [];
  for (const row of rows) {
    const parsed = materialMetaSchema.safeParse(row.meta);
    // 表里存的是发版时同步进去的快照，理论上不会坏；真坏了也只跳过这一个，
    // 不能让整个 AI 功能因为一条脏数据起不来。废弃物料不再给模型——它只用于新建
    if (parsed.success && !parsed.data.deprecated) materials.push(parsed.data);
  }

  return {
    materials,
    names: new Set(materials.map((m) => m.name)),
    containers: new Set(materials.filter((m) => m.isContainer).map((m) => m.name)),
    versions: Object.fromEntries(materials.map((m) => [m.name, m.version])),
    text: materials.map(renderMaterial).join('\n\n'),
  };
}

/** 公共样式项在每个物料上都一样，单独说一次，不必在 12 个物料下各重复一遍 */
export function renderCommonStyleDoc(catalog: MaterialCatalog): string {
  const sample = catalog.materials.find((m) => m.name === 'Container') ?? catalog.materials[0];
  const styleProps = (sample?.propsSchema ?? []).filter((p) => p.group === 'style');
  if (!styleProps.length) return '';
  return [
    '以下样式属性对绝大多数物料通用（Page 与 Modal 除外）：',
    ...styleProps.map(renderProp),
  ].join('\n');
}

import { Collapse, Empty } from 'antd';
import { MATERIAL_CATEGORY, type MaterialCategory } from '@nca/shared';
import type { MaterialMeta } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';

const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  [MATERIAL_CATEGORY.BASIC]: '基础组件',
  [MATERIAL_CATEGORY.CONTAINER]: '容器组件',
  [MATERIAL_CATEGORY.MEDIA]: '媒体组件',
  [MATERIAL_CATEGORY.BUSINESS]: '业务组件',
};

export function MaterialPanel({ metas }: { metas: MaterialMeta[] }) {
  const addNode = useDesignerStore((s) => s.addNode);

  // Page 是根容器，不该出现在工具箱里被再拖一个
  const usable = metas.filter((m) => m.name !== 'Page');
  if (usable.length === 0) {
    return <Empty description="暂无可用物料" style={{ marginTop: 40 }} />;
  }

  const grouped = Object.values(MATERIAL_CATEGORY)
    .map((category) => ({
      category,
      items: usable.filter((m) => m.category === category),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Collapse
      defaultActiveKey={grouped.map((g) => g.category)}
      ghost
      size="small"
      items={grouped.map((group) => ({
        key: group.category,
        label: CATEGORY_LABEL[group.category],
        children: (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {group.items.map((meta) => (
              <div
                key={meta.name}
                title={meta.description}
                onClick={() => addNode(meta.name, meta.defaultProps)}
                style={{
                  padding: '12px 8px',
                  textAlign: 'center',
                  fontSize: 12,
                  cursor: 'pointer',
                  background: '#fafafa',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  userSelect: 'none',
                }}
              >
                {meta.title}
              </div>
            ))}
          </div>
        ),
      }))}
    />
  );
}

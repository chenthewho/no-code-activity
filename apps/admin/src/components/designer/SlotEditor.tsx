import { useState } from 'react';
import { Button, Divider, Select, Space } from 'antd';
import { materialMetas } from '@nca/materials';
import { useDesignerStore } from '../../stores/designer';

/**
 * 具名插槽编辑器：选中声明了 slots 的物料时，在这里往各插槽挂 / 换 / 清内容。
 * 插槽内容存在 node.linkedNodes[slot]（渲染器按 material meta.slots 渲染出来）。
 */
export function SlotEditor() {
  const { dsl, selectedId, addToSlot, removeNode } = useDesignerStore();
  const [picks, setPicks] = useState<Record<string, string>>({});

  if (!selectedId) return null;
  const node = dsl.craftJson[selectedId];
  if (!node) return null;
  const meta = materialMetas.find((m) => m.name === node.type.resolvedName);
  const slots = meta?.slots ?? [];
  if (slots.length === 0) return null;

  const options = materialMetas
    .filter((m) => m.name !== node.type.resolvedName) // 防无限嵌套同类容器
    .map((m) => ({ label: m.title, value: m.name }));

  return (
    <div style={{ marginTop: 8 }}>
      <Divider orientation="left" plain style={{ margin: '8px 0' }}>
        具名插槽
      </Divider>
      {slots.map((slot) => {
        const slotNodeId = node.linkedNodes?.[slot];
        const slotNode = slotNodeId ? dsl.craftJson[slotNodeId] : undefined;
        return (
          <div key={slot} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>◆ {slot}</div>
            {slotNode ? (
              <Space size={4} style={{ marginBottom: 6, display: 'flex' }}>
                <span style={{ fontSize: 12, flex: 1 }}>{slotNode.displayName ?? slotNode.type.resolvedName}</span>
                <Button size="small" danger onClick={() => slotNodeId && removeNode(slotNodeId)}>
                  移除
                </Button>
              </Space>
            ) : (
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>（空）</div>
            )}
            <Space.Compact style={{ width: '100%' }}>
              <Select
                size="small"
                style={{ flex: 1 }}
                placeholder="选物料填入插槽"
                options={options}
                value={picks[slot]}
                onChange={(value) => setPicks((prev) => ({ ...prev, [slot]: value }))}
              />
              <Button
                size="small"
                type="primary"
                disabled={!picks[slot]}
                onClick={() => {
                  if (picks[slot]) addToSlot(selectedId, slot, picks[slot]);
                }}
              >
                填入
              </Button>
            </Space.Compact>
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Button, Space, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { ROOT_NODE_ID } from '@nca/shared';
import { getMaterial } from '@nca/materials';
import { useDesignerStore } from '../../stores/designer';

/** 节点树：画布之外的第二条选中路径，绝对定位或被遮挡的节点靠它才选得中 */
export function NodeTree() {
  const { dsl, selectedId, select, removeNode, moveNode } = useDesignerStore();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // 新增节点后把新分支也展开，运营不用每次手动点开
  const allKeys = Object.keys(dsl.craftJson);
  useEffect(() => {
    setExpandedKeys((prev) => {
      const merged = [...new Set([...prev, ...allKeys])];
      // 没有新键就返回原引用，否则每轮渲染都换新数组会触发多余重渲染
      return merged.length === prev.length ? prev : merged;
    });
    // allKeys 每次渲染都是新数组，故用长度做依赖
  }, [allKeys.length]);

  const build = (nodeId: string): DataNode | null => {
    const node = dsl.craftJson[nodeId];
    if (!node) return null;
    const children = node.nodes.map(build).filter(Boolean) as DataNode[];

    // 具名插槽内容：直接挂在容器下，标题带 [slot] 前缀标识归属
    const material = getMaterial(node.type.resolvedName);
    for (const slot of material?.meta.slots ?? []) {
      const slotNodeId = node.linkedNodes?.[slot];
      if (!slotNodeId) continue;
      const child = build(slotNodeId);
      if (child) {
        children.push({ ...child, title: `[${slot}] ${child.title}` });
      }
    }

    return {
      key: nodeId,
      title: node.displayName ?? node.type.resolvedName,
      children: children.length > 0 ? children : undefined,
    };
  };

  const root = build(ROOT_NODE_ID);
  if (!root) return null;

  return (
    <>
      <Tree
        treeData={[root]}
        selectedKeys={selectedId ? [selectedId] : []}
        // 受控展开而非 defaultExpandAll：树数据是异步加载的，
        // defaultExpandAll 只在首次渲染生效，会让节点树一直折叠着
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys as string[])}
        onSelect={(keys) => select((keys[0] as string) ?? null)}
        style={{ fontSize: 12 }}
      />
      {selectedId && selectedId !== ROOT_NODE_ID && (
        <Space size={4} style={{ marginTop: 8 }}>
          <Button size="small" onClick={() => moveNode(selectedId, -1)}>
            上移
          </Button>
          <Button size="small" onClick={() => moveNode(selectedId, 1)}>
            下移
          </Button>
          <Button size="small" danger onClick={() => removeNode(selectedId)}>
            删除
          </Button>
        </Space>
      )}
    </>
  );
}

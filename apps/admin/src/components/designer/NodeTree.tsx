import { useEffect, useState } from 'react';
import { Button, Space, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { ROOT_NODE_ID } from '@nca/shared';
import { useDesignerStore } from '../../stores/designer';

/** 节点树：画布之外的第二条选中路径，绝对定位或被遮挡的节点靠它才选得中 */
export function NodeTree() {
  const { dsl, selectedId, select, removeNode, moveNode } = useDesignerStore();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // 新增节点后把新分支也展开，运营不用每次手动点开
  const allKeys = Object.keys(dsl.craftJson);
  useEffect(() => {
    setExpandedKeys((prev) => [...new Set([...prev, ...allKeys])]);
    // allKeys 每次渲染都是新数组，用长度做依赖避免无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKeys.length]);

  const build = (nodeId: string): DataNode | null => {
    const node = dsl.craftJson[nodeId];
    if (!node) return null;
    const children = node.nodes.map(build).filter(Boolean) as DataNode[];
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

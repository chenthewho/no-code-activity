import { Empty, List, Popover, Tag } from 'antd';
import type { DslIssue } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';

/**
 * 待完善项汇总。
 *
 * 顶栏常驻一个标签而不是每次改动弹一次 toast——
 * 编辑过程中「还没填完」是常态，逐次弹窗只会把人淹没。
 */
export function IssueIndicator({ issues }: { issues: DslIssue[] }) {
  const select = useDesignerStore((s) => s.select);
  if (issues.length === 0) return null;

  return (
    <Popover
      placement="bottomRight"
      title={`${issues.length} 处待完善，发布前需补齐`}
      content={
        <List
          size="small"
          style={{ width: 320, maxHeight: 320, overflow: 'auto' }}
          dataSource={issues}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(issue) => (
            <List.Item
              style={{ cursor: issue.nodeId ? 'pointer' : 'default', padding: '6px 0' }}
              onClick={() => issue.nodeId && select(issue.nodeId)}
            >
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                {issue.location && <div style={{ color: '#888' }}>{issue.location}</div>}
                <div>{issue.message}</div>
                {issue.nodeId && <a style={{ fontSize: 11 }}>定位到该组件 →</a>}
              </div>
            </List.Item>
          )}
        />
      }
    >
      <Tag color="warning" style={{ cursor: 'pointer' }}>
        待完善 {issues.length}
      </Tag>
    </Popover>
  );
}

/** 把校验问题整理成人话，用于发布被拦时的弹窗 */
export function formatIssues(issues: DslIssue[]): string[] {
  return issues
    .filter((i) => i.level === 'error')
    .map((issue) => (issue.location ? `${issue.location}：${issue.message}` : issue.message));
}

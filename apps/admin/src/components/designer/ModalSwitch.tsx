import { Tooltip } from 'antd';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import type { FinalDsl } from '@nca/dsl';

interface Props {
  dsl: FinalDsl;
  /** 当前展开的弹窗，由选中态推导而来 */
  activeId: string | null;
  onToggle: (modalId: string | null) => void;
}

/**
 * 弹窗展开开关，浮在画布右侧。
 *
 * 放浮层而不是并进右侧设置面板：它是画布的视图状态，不是选中组件的属性，
 * 混进设置面板会跟着选中一起跳走，正要找的开关反而不见了。
 */
export function ModalSwitch({ dsl, activeId, onToggle }: Props) {
  const modals = Object.entries(dsl.craftJson)
    .filter(([, node]) => node.type.resolvedName === 'Modal')
    .map(([id, node]) => ({ id, name: node.displayName ?? '弹窗' }));

  if (modals.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: '100%',
        marginLeft: 12,
        width: 132,
        padding: 8,
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,.06)',
      }}
    >
      <div style={{ marginBottom: 6, color: '#8c8c8c', fontSize: 12 }}>弹窗</div>
      {modals.map((modal) => {
        const active = modal.id === activeId;
        return (
          <Tooltip
            key={modal.id}
            title={active ? '收起弹窗，回到页面' : '展开这个弹窗进行编辑'}
            placement="left"
            mouseEnterDelay={0.5}
          >
            <div
              onClick={() => onToggle(active ? null : modal.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                marginBottom: 4,
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: '18px',
                color: active ? '#1677ff' : '#595959',
                background: active ? '#e6f4ff' : 'transparent',
              }}
            >
              {active ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              <span
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={modal.name}
              >
                {modal.name}
              </span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

import { InputNumber, Tooltip } from 'antd';

interface Spacing {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

const SIDES = [
  { key: 'top', label: '上' },
  { key: 'right', label: '右' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
] as const;

/**
 * 四向间距编辑器。
 *
 * 物料的 margin/padding 既接受数字（四边相同）也接受四值对象，
 * 这里统一按四值编辑，输出时若四边相等则收敛成数字，保持 DSL 简洁。
 */
export function SpacingEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const spacing: Spacing =
    typeof value === 'number'
      ? { top: value, right: value, bottom: value, left: value }
      : ((value as Spacing) ?? {});

  const update = (side: keyof Spacing, next: number | null) => {
    const merged: Spacing = { ...spacing, [side]: next ?? 0 };
    const { top = 0, right = 0, bottom = 0, left = 0 } = merged;

    if (top === 0 && right === 0 && bottom === 0 && left === 0) {
      onChange(undefined);
      return;
    }
    if (top === right && right === bottom && bottom === left) {
      onChange(top);
      return;
    }
    onChange(merged);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
      {SIDES.map((side) => (
        <Tooltip key={side.key} title={`${side.label}间距（设计稿像素）`}>
          <InputNumber
            size="small"
            min={0}
            style={{ width: '100%' }}
            value={spacing[side.key] ?? 0}
            onChange={(next) => update(side.key, next)}
            prefix={<span style={{ fontSize: 11, color: '#bfbfbf' }}>{side.label}</span>}
          />
        </Tooltip>
      ))}
    </div>
  );
}

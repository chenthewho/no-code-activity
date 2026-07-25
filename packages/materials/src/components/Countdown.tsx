import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface CountdownProps extends CommonStyleProps {
  /** 目标时间，ISO 字符串，通常绑定 {{ meta.endTime }} */
  targetTime?: string;
  /** 各段之间的分隔符 */
  separator?: string;
  showDays?: boolean;
  fontSize?: number;
  color?: string;
  /** 数字块背景，留空则纯文字展示 */
  blockColor?: string;
  blockRadius?: number;
  endText?: string;
}

interface Remain {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
}

function calcRemain(target: number): Remain {
  const diff = Math.max(0, target - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    ended: diff <= 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function Countdown({ children: _children, emit, ...props }: MaterialComponentProps<CountdownProps>) {
  const target = props.targetTime ? Date.parse(props.targetTime) : NaN;
  const valid = !Number.isNaN(target);
  const [remain, setRemain] = useState<Remain>(() =>
    valid ? calcRemain(target) : { days: 0, hours: 0, minutes: 0, seconds: 0, ended: false },
  );
  // emit 每次渲染都是新函数，用 ref 持有以免进 effect 依赖导致定时器反复重建
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const endedRef = useRef(false);

  useEffect(() => {
    if (!valid) return;
    const tick = () => {
      const next = calcRemain(target);
      setRemain(next);
      if (next.ended && !endedRef.current) {
        endedRef.current = true;
        emitRef.current?.('end');
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [target, valid]);

  const textStyle: CSSProperties = {
    fontSize: props.fontSize ? `${props.fontSize}px` : '32px',
    color: props.color || '#333333',
  };
  const blockStyle: CSSProperties = props.blockColor
    ? {
        backgroundColor: props.blockColor,
        borderRadius: `${props.blockRadius ?? 6}px`,
        padding: '4px 10px',
      }
    : {};

  if (!valid) {
    return <div className="nca-countdown nca-countdown--empty">请配置目标时间</div>;
  }
  if (remain.ended) {
    return (
      <div className="nca-countdown" style={mergeStyle(commonStyle(props), textStyle)}>
        {props.endText ?? '活动已结束'}
      </div>
    );
  }

  const sep = props.separator ?? ':';
  const parts = props.showDays
    ? [pad(remain.days), pad(remain.hours), pad(remain.minutes), pad(remain.seconds)]
    : [pad(remain.days * 24 + remain.hours), pad(remain.minutes), pad(remain.seconds)];

  return (
    <div className="nca-countdown" style={mergeStyle(commonStyle(props), textStyle)}>
      {parts.map((part, i) => (
        <span key={i} className="nca-countdown__group">
          <span className="nca-countdown__block" style={blockStyle}>
            {part}
          </span>
          {i < parts.length - 1 && <span className="nca-countdown__sep">{sep}</span>}
        </span>
      ))}
    </div>
  );
}

export const CountdownMaterial = defineMaterial<CountdownProps>({
  Component: Countdown,
  meta: defineMeta({
    name: 'Countdown',
    version: '1.0.0',
    title: '倒计时',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'clock',
    description: '倒计时结束会抛出 end 事件，可接刷新数据源等动作',
    defaultProps: { separator: ':', showDays: false, fontSize: 32, color: '#333333' },
    events: [{ name: 'end', label: '倒计时结束', payloadKeys: [] }],
    propsSchema: [
      prop({
        key: 'targetTime',
        label: '目标时间',
        editor: 'string',
        bindable: true,
        placeholder: '{{ meta.endTime }}',
        help: 'ISO 时间字符串，可绑定活动结束时间',
      }),
      prop({ key: 'showDays', label: '单独显示天数', editor: 'boolean' }),
      prop({ key: 'separator', label: '分隔符', editor: 'string' }),
      prop({ key: 'endText', label: '结束文案', editor: 'string' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 120 }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      styleProp({ key: 'blockColor', label: '数字底色', editor: 'color' }),
      styleProp({ key: 'blockRadius', label: '数字底圆角', editor: 'number', min: 0 }),
      ...commonStyleSchema,
    ],
  }),
});

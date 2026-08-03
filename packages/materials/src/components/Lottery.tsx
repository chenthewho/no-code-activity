import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, toSize, type CommonStyleProps } from '../utils/style';

export interface LotteryProps extends CommonStyleProps {
  /** 九宫格或转盘，两种形态共用同一套抽奖时序 */
  mode?: 'grid' | 'wheel';
  /** 奖品列表，可直接配置，也可绑定 {{ dataSource.prizes }} */
  prizes?: Record<string, unknown>[];
  nameKey?: string;
  imageKey?: string;
  /**
   * 中奖序号。由后端接口决定，通过状态或数据源绑进来，
   * 值合法（0 ~ 奖品数-1）时动画才会落停。
   */
  resultIndex?: number | string;
  buttonText?: string;
  buttonImage?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  disabled?: boolean;
  disabledText?: string;
  /** 落停前至少转几圈 */
  rounds?: number;
  /** 转动时长，九宫格按它折算每格间隔，转盘用作落停动画时长 */
  duration?: number;
  /** 等不到结果的兜底时长，超时抛 timeout 事件 */
  timeout?: number;
  cellColor?: string;
  activeColor?: string;
  color?: string;
  fontSize?: number;
  gap?: number;
  cellRadius?: number;
}

/** 3×3 九宫格外圈的顺时针顺序，中心格留给抽奖按钮 */
const RING = [0, 1, 2, 5, 8, 7, 6, 3];

/** 等结果期间转盘每圈的时长，与 CSS transition 时长保持一致才不卡顿 */
const SPIN_TURN_MS = 1000;

type Phase = 'idle' | 'running' | 'landing';

/**
 * 绑定表达式求值出来的可能是字符串（"3"），也可能是越界的脏数据，
 * 统一收口成「合法序号」或 null，null 表示结果还没到。
 */
function normalizeIndex(value: unknown, count: number): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= count) return null;
  return n;
}

/**
 * 抽奖时序：点击 → 空转 → 结果到达 → 落停 → 抛 finish。
 *
 * 结果不由物料自己产生：中奖概率、库存扣减都必须在服务端定，物料只负责把
 * 后端给的序号演成一段动画。因此 resultIndex 是绑定进来的——运营编排成
 * 「点击 → lottery.draw → 写回状态」，物料看到合法序号才落停。
 * 抽奖前记得把绑定的状态置为 -1，否则会拿上一轮的结果立刻停住。
 */
function Lottery({
  children: _children,
  emit,
  editing,
  ...props
}: MaterialComponentProps<LotteryProps>) {
  const mode = props.mode === 'wheel' ? 'wheel' : 'grid';
  const prizes = Array.isArray(props.prizes) ? props.prizes : [];
  const slots = mode === 'grid' ? RING.length : prizes.length;
  /** 奖品少于格子数时，只有真实奖品对应的序号才算合法结果 */
  const resultRange = Math.min(prizes.length, slots);
  const rounds = Math.max(1, Math.floor(props.rounds ?? 4));
  const duration = Math.max(500, props.duration ?? 3000);
  const disabled = Boolean(props.disabled);

  const [phase, setPhase] = useState<Phase>('idle');
  /** 九宫格当前跑到第几个外圈位置 */
  const [active, setActive] = useState(0);
  /** 转盘累计角度，只增不减，落停动画靠它插值 */
  const [rotation, setRotation] = useState(0);
  /** 停下后中奖的那一格，用于保持高亮 */
  const [landed, setLanded] = useState<number | null>(null);

  const targetRef = useRef<number | null>(null);
  /** 九宫格总步数，结果到达那一刻才算得出来 */
  const totalRef = useRef(-1);
  // emit 每次渲染都是新函数，用 ref 持有以免进 effect 依赖导致动画反复重启
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const prizesRef = useRef(prizes);
  prizesRef.current = prizes;

  const reset = useCallback(() => {
    targetRef.current = null;
    totalRef.current = -1;
  }, []);

  const settle = useCallback(
    (index: number) => {
      reset();
      setPhase('idle');
      setLanded(index);
      emitRef.current?.('finish', { index, prize: prizesRef.current[index] });
    },
    [reset],
  );

  // 九宫格跑马灯。结果没到就一直转，到了就算出还差几步能停在中奖格上
  useEffect(() => {
    if (mode !== 'grid' || phase !== 'running') return;
    const base = Math.max(40, duration / (rounds * RING.length));
    let steps = 0;
    let timer = 0;

    const tick = () => {
      steps += 1;
      setActive(steps % RING.length);

      const target = targetRef.current;
      if (target !== null && totalRef.current < 0) {
        // 先补满圈数，再补齐走到中奖格的余量
        const min = steps + rounds * RING.length;
        totalRef.current = min + ((target - (min % RING.length) + RING.length) % RING.length);
      }
      if (target !== null && totalRef.current >= 0 && steps >= totalRef.current) {
        settle(target);
        return;
      }

      const left = totalRef.current < 0 ? Infinity : totalRef.current - steps;
      // 最后一圈逐格减速，停下来才有「就差一点」的观感
      const delay = left > RING.length ? base : base * (1 + (RING.length - left) * 0.5);
      timer = window.setTimeout(tick, delay);
    };

    timer = window.setTimeout(tick, base);
    return () => window.clearTimeout(timer);
  }, [mode, phase, duration, rounds, settle]);

  // 转盘空转：每秒加一圈，配 linear 过渡就是匀速转
  useEffect(() => {
    if (mode !== 'wheel' || phase !== 'running') return;
    setRotation((r) => r + 360);
    const timer = window.setInterval(() => setRotation((r) => r + 360), SPIN_TURN_MS);
    return () => window.clearInterval(timer);
  }, [mode, phase]);

  // 结果到达：九宫格交给跑马灯自己收尾，转盘直接算出落停角度
  useEffect(() => {
    if (phase !== 'running') return;
    const index = normalizeIndex(props.resultIndex, resultRange);
    if (index === null) return;
    targetRef.current = index;
    if (mode !== 'wheel') return;

    const sector = 360 / slots;
    setPhase('landing');
    setRotation((r) => {
      const base = r + rounds * 360;
      // 让中奖扇区的中线正对顶部指针
      const delta = (((-(index * sector + sector / 2) - base) % 360) + 360) % 360;
      return base + delta;
    });
  }, [phase, props.resultIndex, resultRange, mode, slots, rounds]);

  // 落停动画结束。单开一个 effect，避免上面那个 effect 因 phase 变化把它清掉
  useEffect(() => {
    if (phase !== 'landing') return;
    const index = targetRef.current;
    if (index === null) return;
    const timer = window.setTimeout(() => settle(index), duration);
    return () => window.clearTimeout(timer);
  }, [phase, duration, settle]);

  // 兜底：接口挂了或压根没编排动作时，别让它一直转下去
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setTimeout(
      () => {
        reset();
        setPhase('idle');
        emitRef.current?.('timeout');
      },
      Math.max(1000, props.timeout ?? 10000),
    );
    return () => window.clearTimeout(timer);
  }, [phase, props.timeout, reset]);

  const handleDraw = () => {
    if (disabled || phase !== 'idle') return;
    emit?.('draw');
    // 编辑态不起转：画布内容不停变动会让运营无法稳定选中格子
    if (editing || prizes.length === 0) return;
    reset();
    setLanded(null);
    setPhase('running');
  };

  const nameKey = props.nameKey || 'name';
  const imageKey = props.imageKey || 'image';
  const fontSize = dp(props.fontSize ?? 24);
  const color = props.color || '#8c4b12';
  const cellColor = props.cellColor || '#fff7e6';
  const activeColor = props.activeColor || '#ffd591';

  const button = (
    <button
      type="button"
      className={`nca-lottery__btn${mode === 'wheel' ? ' nca-lottery__btn--pointer' : ''}`}
      disabled={disabled}
      style={{
        backgroundImage: props.buttonImage ? `url(${props.buttonImage})` : undefined,
        backgroundColor: props.buttonImage ? 'transparent' : props.buttonColor || '#ff4d4f',
        color: props.buttonTextColor || '#ffffff',
        fontSize,
        borderRadius: mode === 'wheel' ? '50%' : dp(props.cellRadius ?? 12),
        opacity: disabled ? 0.6 : undefined,
      }}
      onClick={handleDraw}
    >
      {disabled && props.disabledText ? props.disabledText : (props.buttonText ?? '抽奖')}
    </button>
  );

  const prizeContent = (prize: Record<string, unknown> | undefined) => (
    <>
      {prize?.[imageKey] ? (
        <img className="nca-lottery__img" src={String(prize[imageKey])} alt="" />
      ) : null}
      <span className="nca-lottery__name">{String(prize?.[nameKey] ?? '')}</span>
    </>
  );

  if (prizes.length === 0) {
    return (
      <div className="nca-lottery nca-lottery--empty" style={commonStyle(props)}>
        请配置奖品
      </div>
    );
  }

  if (mode === 'grid') {
    return (
      <div
        className="nca-lottery nca-lottery--grid"
        style={mergeStyle(commonStyle(props), {
          width: toSize(props.width) ?? dp(600),
          gap: dp(props.gap ?? 12),
        })}
      >
        {Array.from({ length: 9 }, (_, slot) => {
          if (slot === 4) {
            return (
              <div key={slot} className="nca-lottery__center">
                {button}
              </div>
            );
          }
          const index = RING.indexOf(slot);
          const highlighted = phase === 'idle' ? landed === index : active === index;
          const cellStyle: CSSProperties = {
            backgroundColor: highlighted ? activeColor : cellColor,
            borderRadius: dp(props.cellRadius ?? 12),
            color,
            fontSize,
          };
          return (
            <div
              key={slot}
              className={`nca-lottery__cell${highlighted ? ' nca-lottery__cell--active' : ''}`}
              style={cellStyle}
            >
              {prizeContent(prizes[index])}
            </div>
          );
        })}
      </div>
    );
  }

  const sector = 360 / slots;
  const stops = prizes
    .map((_, i) => `${i % 2 ? activeColor : cellColor} ${i * sector}deg ${(i + 1) * sector}deg`)
    .join(', ');

  return (
    <div
      className="nca-lottery nca-lottery--wheel"
      style={mergeStyle(commonStyle(props), { width: toSize(props.width) ?? dp(600) })}
    >
      <div
        className="nca-lottery__wheel"
        style={{
          background: `conic-gradient(${stops})`,
          transform: `rotate(${rotation}deg)`,
          transition:
            phase === 'running'
              ? `transform ${SPIN_TURN_MS}ms linear`
              : `transform ${duration}ms cubic-bezier(.15,.6,.25,1)`,
        }}
      >
        {prizes.map((prize, i) => (
          <div
            key={i}
            className="nca-lottery__sector"
            style={{ transform: `rotate(${i * sector + sector / 2}deg)`, color, fontSize }}
          >
            {prizeContent(prize)}
          </div>
        ))}
      </div>
      {button}
    </div>
  );
}

export const LotteryMaterial = defineMaterial<LotteryProps>({
  Component: Lottery,
  meta: defineMeta({
    name: 'Lottery',
    version: '1.0.0',
    title: '抽奖',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'gift',
    description: '九宫格 / 转盘抽奖，点击抛 draw 事件，动画停在绑定的中奖序号上',
    defaultProps: {
      mode: 'grid',
      nameKey: 'name',
      imageKey: 'image',
      buttonText: '抽奖',
      rounds: 4,
      duration: 3000,
      timeout: 10000,
      width: 600,
      cellColor: '#fff7e6',
      activeColor: '#ffd591',
      buttonColor: '#ff4d4f',
      color: '#8c4b12',
      fontSize: 24,
      gap: 12,
      cellRadius: 12,
    },
    events: [
      { name: 'draw', label: '点击抽奖', payloadKeys: [] },
      { name: 'finish', label: '开奖动画结束', payloadKeys: ['index', 'prize'] },
      { name: 'timeout', label: '结果超时', payloadKeys: [] },
    ],
    propsSchema: [
      prop({
        key: 'mode',
        label: '形态',
        editor: 'radio',
        options: [
          { label: '九宫格', value: 'grid' },
          { label: '转盘', value: 'wheel' },
        ],
      }),
      prop({
        key: 'prizes',
        label: '奖品列表',
        editor: 'json',
        bindable: true,
        help: '数组，每项 { name, image }；九宫格最多展示 8 项，也可绑定数据源',
      }),
      prop({ key: 'nameKey', label: '名称字段', editor: 'string' }),
      prop({ key: 'imageKey', label: '图片字段', editor: 'string' }),
      prop({
        key: 'resultIndex',
        label: '中奖序号',
        editor: 'string',
        bindable: true,
        placeholder: '{{ state.prizeIndex }}',
        help: '后端返回的中奖序号，从 0 开始；抽奖前先把它置为 -1，否则会停在上一轮结果上',
      }),
      prop({ key: 'buttonText', label: '按钮文案', editor: 'string', bindable: true }),
      prop({ key: 'disabled', label: '禁用', editor: 'boolean', bindable: true }),
      prop({
        key: 'disabledText',
        label: '禁用文案',
        editor: 'string',
        bindable: true,
        visibleWhen: '{{ props.disabled }}',
      }),
      prop({ key: 'rounds', label: '落停前圈数', editor: 'number', min: 1, max: 20 }),
      prop({
        key: 'duration',
        label: '转动时长(ms)',
        editor: 'number',
        min: 500,
        max: 20000,
        step: 100,
      }),
      prop({
        key: 'timeout',
        label: '结果超时(ms)',
        editor: 'number',
        min: 1000,
        max: 60000,
        step: 1000,
        help: '超时仍未拿到结果就停下并抛 timeout 事件，可接一个提示',
      }),
      styleProp({ key: 'buttonImage', label: '按钮图', editor: 'image' }),
      styleProp({ key: 'buttonColor', label: '按钮底色', editor: 'color' }),
      styleProp({ key: 'buttonTextColor', label: '按钮文字色', editor: 'color' }),
      styleProp({ key: 'cellColor', label: '格子底色', editor: 'color' }),
      styleProp({ key: 'activeColor', label: '高亮色', editor: 'color' }),
      styleProp({ key: 'color', label: '奖品文字色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 100 }),
      styleProp({
        key: 'gap',
        label: '格子间距',
        editor: 'number',
        min: 0,
        max: 100,
        visibleWhen: "{{ props.mode === 'grid' }}",
      }),
      styleProp({
        key: 'cellRadius',
        label: '格子圆角',
        editor: 'number',
        min: 0,
        visibleWhen: "{{ props.mode === 'grid' }}",
      }),
      ...commonStyleSchema,
    ],
  }),
});

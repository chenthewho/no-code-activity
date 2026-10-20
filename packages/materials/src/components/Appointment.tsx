import { MATERIAL_CATEGORY, type AppointmentSceneView } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface AppointmentProps extends CommonStyleProps {
  /** single：一个按钮约 sceneId 这一场；list：列出后台配置的全部场次，各约各的 */
  layout?: 'single' | 'list';
  /** 场次编码，与后台「预约场次」里的编码对应；single 模式用 */
  sceneId?: string;
  sceneName?: string;
  buttonText?: string;
  /** 已预约态：运营也可以把 state/数据源里的预约标记绑进来 */
  booked?: boolean;
  buttonColor?: string;
  fontSize?: number;
  /** 后台配置的场次（剩余名额、状态、我约过没有），由运行时注入，不在 DSL 里配 */
  scenes?: AppointmentSceneView[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 「10月25日 14:00–15:00」；跨天写全；只有一头的写「起 / 截至」 */
export function formatSceneTime(startAt?: string, endAt?: string): string {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (start && end) {
    return day(start) === day(end)
      ? `${day(start)} ${clock(start)}–${clock(end)}`
      : `${day(start)} ${clock(start)} – ${day(end)} ${clock(end)}`;
  }
  if (start) return `${day(start)} ${clock(start)} 开始`;
  if (end) return `截至 ${day(end)} ${clock(end)}`;
  return '';
}

/** 按钮该显示什么、能不能点 */
function sceneButton(
  scene: AppointmentSceneView | undefined,
  booked: boolean,
  text: string,
): { label: string; disabled: boolean } {
  if (booked || scene?.booked) return { label: '已预约', disabled: true };
  if (scene?.status === 'full') return { label: '已约满', disabled: true };
  if (scene?.status === 'closed') return { label: '已截止', disabled: true };
  return { label: text, disabled: false };
}

/** 设计器里还没配场次时的示意数据，好让运营看到列表长什么样 */
const SAMPLE_SCENES: AppointmentSceneView[] = [
  { sceneId: 'sample_1', name: '第一场（示例）', capacity: 50, remaining: 12, status: 'open', booked: false },
  { sceneId: 'sample_2', name: '第二场（示例）', capacity: 50, remaining: 0, status: 'full', booked: false },
];

/**
 * 预约物料。点击即预约（运行时内建，不用再绑动作），一人一场次一次；
 * 名额、开场截止由服务端执行，这里只展示剩余与状态。
 * 后台没配场次的早期活动按 sceneId 预约，不限名额。
 */
function Appointment({
  children: _children,
  emit,
  editing,
  ...props
}: MaterialComponentProps<AppointmentProps>) {
  const color = props.buttonColor || '#1677ff';
  const buttonStyle = (disabled: boolean, size: number) => ({
    padding: `${dp(size * 0.66)} ${dp(size * 1.6)}`,
    borderRadius: dp(999),
    border: 'none',
    fontSize: dp(size),
    color: '#fff',
    backgroundColor: disabled ? '#bbb' : color,
    flexShrink: 0,
  });

  if (props.layout === 'list') {
    const scenes = props.scenes?.length ? props.scenes : editing ? SAMPLE_SCENES : [];
    return (
      <div className="nca-appointment nca-appointment--list" style={mergeStyle(commonStyle(props), {})}>
        {props.sceneName ? (
          <div style={{ fontSize: dp(30), color: '#333', marginBottom: dp(16), textAlign: 'center' }}>
            {props.sceneName}
          </div>
        ) : null}
        {scenes.length === 0 ? (
          <div style={{ fontSize: dp(26), color: '#999', textAlign: 'center', padding: dp(24) }}>
            暂无可预约的场次
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: dp(16) }}>
            {scenes.map((scene) => {
              const button = sceneButton(scene, false, props.buttonText || '预约');
              const time = formatSceneTime(scene.startAt, scene.endAt);
              return (
                <div
                  key={scene.sceneId}
                  className="nca-appointment__scene"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: dp(16),
                    padding: `${dp(20)} ${dp(24)}`,
                    borderRadius: dp(16),
                    background: '#fff',
                    border: '1px solid #f0f0f0',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: dp(28), color: '#333' }}>{scene.name}</div>
                    {time ? <div style={{ fontSize: dp(22), color: '#999', marginTop: dp(6) }}>{time}</div> : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: dp(16), flexShrink: 0 }}>
                    {!button.disabled && scene.remaining !== null ? (
                      <span style={{ fontSize: dp(22), color: '#fa8c16' }}>余 {scene.remaining}</span>
                    ) : null}
                    <button
                      type="button"
                      className="nca-appointment__btn"
                      disabled={button.disabled}
                      style={buttonStyle(button.disabled, 24)}
                      onClick={() => {
                        if (!button.disabled) emit?.('appointment', { sceneId: scene.sceneId });
                      }}
                    >
                      {button.label}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const scene = props.scenes?.find((s) => s.sceneId === props.sceneId);
  const button = sceneButton(scene, Boolean(props.booked), props.buttonText ?? '立即预约');
  const time = scene ? formatSceneTime(scene.startAt, scene.endAt) : '';
  return (
    <div className="nca-appointment" style={mergeStyle(commonStyle(props), { textAlign: 'center' })}>
      {props.sceneName ? (
        <div style={{ fontSize: dp(28), color: '#333', marginBottom: dp(time ? 4 : 16) }}>{props.sceneName}</div>
      ) : null}
      {time ? <div style={{ fontSize: dp(22), color: '#999', marginBottom: dp(16) }}>{time}</div> : null}
      <button
        type="button"
        className="nca-appointment__btn"
        disabled={button.disabled}
        style={buttonStyle(button.disabled, props.fontSize ?? 30)}
        onClick={() => {
          if (button.disabled) return;
          emit?.('appointment', { sceneId: props.sceneId });
        }}
      >
        {button.label}
      </button>
      {!button.disabled && scene && scene.remaining !== null ? (
        <div style={{ fontSize: dp(22), color: '#fa8c16', marginTop: dp(12) }}>剩余 {scene.remaining} 个名额</div>
      ) : null}
    </div>
  );
}

export const AppointmentMaterial = defineMaterial<AppointmentProps>({
  Component: Appointment,
  meta: defineMeta({
    name: 'Appointment',
    version: '1.1.0',
    title: '预约',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'calendar',
    description: '活动预约：点击即预约，一人一场次一次；场次的时间与名额在活动详情「预约场次」里配置',
    defaultProps: {
      layout: 'single',
      sceneId: 'scene_default',
      sceneName: '现场体验场',
      buttonText: '立即预约',
      buttonColor: '#1677ff',
    },
    events: [{ name: 'appointment', label: '点击预约', payloadKeys: ['sceneId'] }],
    propsSchema: [
      prop({
        key: 'layout',
        label: '展示方式',
        editor: 'select',
        options: [
          { label: '单个场次', value: 'single' },
          { label: '场次列表', value: 'list' },
        ],
        help: '场次列表会列出后台配置的全部场次，各自显示剩余名额',
      }),
      prop({
        key: 'sceneId',
        label: '场次编码',
        editor: 'string',
        bindable: true,
        help: '单个场次模式下约哪一场，与后台「预约场次」的编码一致',
      }),
      prop({ key: 'sceneName', label: '标题', editor: 'string' }),
      prop({ key: 'buttonText', label: '按钮文案', editor: 'string', bindable: true }),
      prop({ key: 'booked', label: '已预约', editor: 'boolean', bindable: true }),
      styleProp({ key: 'buttonColor', label: '按钮颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 120 }),
      ...commonStyleSchema,
    ],
  }),
});

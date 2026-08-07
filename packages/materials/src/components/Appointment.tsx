import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface AppointmentProps extends CommonStyleProps {
  /** 场次 id，提交预约时带上；运营可把不同按钮配成不同场次 */
  sceneId?: string;
  sceneName?: string;
  buttonText?: string;
  /** 已预约态：运营把 state/数据源里的预约标记绑进来，为真时按钮置灰 */
  booked?: boolean;
  buttonColor?: string;
  fontSize?: number;
}

/**
 * 预约物料。点击 emit('appointment', { sceneId })，运营把「点击预约」事件
 * 绑到 appointment 动作即可上报到 POST /runtime/appointment（一人一场次一次）。
 */
function Appointment({ children: _children, emit, ...props }: MaterialComponentProps<AppointmentProps>) {
  const booked = Boolean(props.booked);
  return (
    <div style={mergeStyle(commonStyle(props), { textAlign: 'center' })}>
      {props.sceneName ? (
        <div style={{ fontSize: dp(28), color: '#333', marginBottom: dp(16) }}>{props.sceneName}</div>
      ) : null}
      <button
        type="button"
        className="nca-appointment__btn"
        disabled={booked}
        style={{
          padding: `${dp(20)} ${dp(48)}`,
          borderRadius: dp(999),
          border: 'none',
          fontSize: dp(props.fontSize ?? 30),
          color: '#fff',
          backgroundColor: booked ? '#bbb' : props.buttonColor || '#1677ff',
        }}
        onClick={() => {
          if (booked) return;
          emit?.('appointment', { sceneId: props.sceneId });
        }}
      >
        {booked ? '已预约' : (props.buttonText ?? '立即预约')}
      </button>
    </div>
  );
}

export const AppointmentMaterial = defineMaterial<AppointmentProps>({
  Component: Appointment,
  meta: defineMeta({
    name: 'Appointment',
    version: '1.0.0',
    title: '预约',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'calendar',
    description: '活动预约按钮：点击事件绑定 appointment 动作，一人一场次只能预约一次',
    defaultProps: {
      sceneId: 'scene_default',
      sceneName: '现场体验场',
      buttonText: '立即预约',
      buttonColor: '#1677ff',
    },
    events: [{ name: 'appointment', label: '点击预约', payloadKeys: ['sceneId'] }],
    propsSchema: [
      prop({ key: 'sceneId', label: '场次 id', editor: 'string', bindable: true }),
      prop({ key: 'sceneName', label: '场次名称', editor: 'string' }),
      prop({ key: 'buttonText', label: '按钮文案', editor: 'string', bindable: true }),
      prop({ key: 'booked', label: '已预约', editor: 'boolean', bindable: true }),
      styleProp({ key: 'buttonColor', label: '按钮颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 120 }),
      ...commonStyleSchema,
    ],
  }),
});

import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface LoginProps extends CommonStyleProps {
  /** 登录态，通常绑定 {{ state.userId }}，有值即视为已登录 */
  logged?: boolean | string | number;
  nickname?: string;
  avatar?: string;
  defaultAvatar?: string;
  /** 未登录时的引导文案 */
  tip?: string;
  loginText?: string;
  showAvatar?: boolean;
  showLogout?: boolean;
  logoutText?: string;
  /** 已登录时昵称前的前缀，如「Hi, 」 */
  greeting?: string;
  color?: string;
  fontSize?: number;
  buttonColor?: string;
  buttonImage?: string;
  buttonTextColor?: string;
  avatarSize?: number;
}

/**
 * 绑定表达式给过来的可能是字符串。'' / '0' / 'false' 都得当成未登录，
 * 否则 {{ state.userId }} 还没赋值时会误判成已登录。
 */
function isLogged(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value !== '' && value !== 'false' && value !== '0';
  return Boolean(value);
}

/**
 * 登录入口。登录动作本身由 EventBinder 的 login 动作走宿主适配层完成
 * （各宿主的登录方式差得很远：浏览器跳 SSO、SDK 走原生弹窗），
 * 物料只负责两件事：展示登录态、把用户的点击抛出去。
 */
function Login({ children: _children, emit, ...props }: MaterialComponentProps<LoginProps>) {
  const logged = isLogged(props.logged);
  const fontSize = dp(props.fontSize ?? 26);
  const color = props.color || '#333333';
  const avatarSize = dp(props.avatarSize ?? 72);

  const textStyle: CSSProperties = { color, fontSize };
  const buttonStyle: CSSProperties = {
    backgroundImage: props.buttonImage ? `url(${props.buttonImage})` : undefined,
    backgroundColor: props.buttonImage ? 'transparent' : props.buttonColor || '#1677ff',
    color: props.buttonTextColor || '#ffffff',
    fontSize,
  };

  // 没配头像就摆一个灰圆占位：src="" 会被浏览器当成请求当前页，渲染出裂图
  const avatarUrl = (logged ? props.avatar : '') || props.defaultAvatar || '';
  const avatarStyle: CSSProperties = { width: avatarSize, height: avatarSize };
  const avatar =
    props.showAvatar === false ? null : avatarUrl ? (
      <img className="nca-login__avatar" style={avatarStyle} src={avatarUrl} alt="" />
    ) : (
      <span className="nca-login__avatar nca-login__avatar--empty" style={avatarStyle} />
    );

  if (logged) {
    return (
      <div
        className="nca-login nca-login--logged"
        style={mergeStyle(commonStyle(props), textStyle)}
      >
        {avatar}
        <span className="nca-login__name">
          {(props.greeting ?? '') + (props.nickname || '游客')}
        </span>
        {props.showLogout && (
          <button
            type="button"
            className="nca-login__logout"
            style={textStyle}
            onClick={() => emit?.('logout')}
          >
            {props.logoutText ?? '退出'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="nca-login" style={mergeStyle(commonStyle(props), textStyle)}>
      {avatar}
      {props.tip !== '' && <span className="nca-login__tip">{props.tip ?? '登录后参与活动'}</span>}
      <button
        type="button"
        className="nca-login__btn"
        style={buttonStyle}
        onClick={() => emit?.('login')}
      >
        {props.loginText ?? '登录'}
      </button>
    </div>
  );
}

export const LoginMaterial = defineMaterial<LoginProps>({
  Component: Login,
  meta: defineMeta({
    name: 'Login',
    version: '1.0.0',
    title: '登录',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'user',
    description: '未登录展示登录入口，点击抛 login 事件接「拉起登录」动作；已登录展示头像昵称',
    defaultProps: {
      loginText: '登录',
      tip: '登录后参与活动',
      showAvatar: true,
      showLogout: false,
      logoutText: '退出',
      fontSize: 26,
      color: '#333333',
      buttonColor: '#1677ff',
      buttonTextColor: '#ffffff',
      avatarSize: 72,
    },
    events: [
      { name: 'login', label: '点击登录', payloadKeys: [] },
      { name: 'logout', label: '点击退出', payloadKeys: [] },
    ],
    propsSchema: [
      prop({
        key: 'logged',
        label: '登录态',
        editor: 'string',
        bindable: true,
        placeholder: '{{ state.userId }}',
        help: '绑定登录后写入的状态或数据源字段，有值即按已登录展示',
      }),
      prop({
        key: 'nickname',
        label: '昵称',
        editor: 'string',
        bindable: true,
        placeholder: '{{ state.nickname }}',
      }),
      prop({
        key: 'avatar',
        label: '头像',
        editor: 'image',
        bindable: true,
        placeholder: '{{ state.avatar }}',
        visibleWhen: '{{ props.showAvatar }}',
      }),
      prop({
        key: 'defaultAvatar',
        label: '默认头像',
        editor: 'image',
        visibleWhen: '{{ props.showAvatar }}',
      }),
      prop({ key: 'showAvatar', label: '显示头像', editor: 'boolean' }),
      prop({ key: 'greeting', label: '昵称前缀', editor: 'string', placeholder: 'Hi, ' }),
      prop({ key: 'tip', label: '未登录文案', editor: 'string' }),
      prop({ key: 'loginText', label: '登录按钮文案', editor: 'string' }),
      prop({ key: 'showLogout', label: '显示退出按钮', editor: 'boolean' }),
      prop({
        key: 'logoutText',
        label: '退出文案',
        editor: 'string',
        visibleWhen: '{{ props.showLogout }}',
      }),
      styleProp({ key: 'buttonImage', label: '按钮图', editor: 'image' }),
      styleProp({ key: 'buttonColor', label: '按钮底色', editor: 'color' }),
      styleProp({ key: 'buttonTextColor', label: '按钮文字色', editor: 'color' }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 100 }),
      styleProp({
        key: 'avatarSize',
        label: '头像尺寸',
        editor: 'number',
        min: 20,
        max: 300,
        visibleWhen: '{{ props.showAvatar }}',
      }),
      ...commonStyleSchema,
    ],
  }),
});

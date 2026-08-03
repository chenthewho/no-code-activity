import { useState, type CSSProperties } from 'react';
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
  /**
   * dialog：点按钮弹出内建的账号密码框；
   * action：只抛 login 事件，登录交给「拉起登录」动作走宿主 SDK
   */
  mode?: 'dialog' | 'action';
  /** 提交后本地即视为已登录。接了真实登录接口就关掉，登录态只认上面的绑定 */
  localSession?: boolean;
  /** 未登录时的引导文案 */
  tip?: string;
  loginText?: string;
  showAvatar?: boolean;
  showLogout?: boolean;
  logoutText?: string;
  /** 已登录时昵称前的前缀，如「Hi, 」 */
  greeting?: string;
  dialogTitle?: string;
  accountLabel?: string;
  accountPlaceholder?: string;
  passwordLabel?: string;
  passwordPlaceholder?: string;
  submitText?: string;
  cancelText?: string;
  errorText?: string;
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
 * 登录入口。
 *
 * 默认自带账号密码弹窗：活动页最常见的形态就是「点一下、填账号、进去抽奖」，
 * 若把这一步交给运营用弹窗物料自己拼，每个活动都要重拼一遍，还拼不一致。
 * 提交只抛 submit 事件（带账号密码），校验归后端——物料不做任何认证判断。
 * 接宿主 SSO 的场景把形态切成 action，弹窗让位给 login 动作。
 */
function Login({
  children: _children,
  emit,
  editing,
  ...props
}: MaterialComponentProps<LoginProps>) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  /** 本地登录态里记住的账号，仅在 localSession 打开时生效 */
  const [session, setSession] = useState<string | null>(null);

  const local = props.localSession !== false;
  const logged = isLogged(props.logged) || (local && session !== null);

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

  const handleEntry = () => {
    emit?.('login');
    // 编辑态不弹：画布里的点击本就被交互层拦着，弹出来也只会挡住页面
    if (props.mode === 'action' || editing) return;
    setError('');
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!account.trim() || !password) {
      setError(props.errorText ?? '请输入账号和密码');
      return;
    }
    emit?.('submit', { username: account.trim(), password });
    if (local) setSession(account.trim());
    // 密码不在组件里留存，关窗即清
    setPassword('');
    setError('');
    setOpen(false);
  };

  const dialog = open && (
    <div className="nca-dialog" onClick={() => setOpen(false)}>
      <div className="nca-dialog__panel" onClick={(e) => e.stopPropagation()}>
        <div className="nca-dialog__title">{props.dialogTitle ?? '登录'}</div>
        <label className="nca-dialog__field">
          <span className="nca-dialog__label">{props.accountLabel ?? '账号'}</span>
          <input
            className="nca-dialog__input"
            value={account}
            placeholder={props.accountPlaceholder ?? '请输入账号'}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <label className="nca-dialog__field">
          <span className="nca-dialog__label">{props.passwordLabel ?? '密码'}</span>
          <input
            className="nca-dialog__input"
            type="password"
            value={password}
            placeholder={props.passwordPlaceholder ?? '请输入密码'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="nca-dialog__error">{error}</div>}
        <div className="nca-dialog__footer">
          <button type="button" className="nca-dialog__btn" onClick={() => setOpen(false)}>
            {props.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className="nca-dialog__btn nca-dialog__btn--primary"
            style={buttonStyle}
            onClick={handleSubmit}
          >
            {props.submitText ?? '登录'}
          </button>
        </div>
      </div>
    </div>
  );

  if (logged) {
    return (
      <>
        <div
          className="nca-login nca-login--logged"
          style={mergeStyle(commonStyle(props), textStyle)}
        >
          {avatar}
          <span className="nca-login__name">
            {(props.greeting ?? '') + (props.nickname || session || '游客')}
          </span>
          {props.showLogout !== false && (
            <button
              type="button"
              className="nca-login__logout"
              style={textStyle}
              onClick={() => {
                setSession(null);
                setAccount('');
                emit?.('logout');
              }}
            >
              {props.logoutText ?? '退出'}
            </button>
          )}
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className="nca-login" style={mergeStyle(commonStyle(props), textStyle)}>
        {avatar}
        {props.tip !== '' && (
          <span className="nca-login__tip">{props.tip ?? '登录后参与活动'}</span>
        )}
        <button type="button" className="nca-login__btn" style={buttonStyle} onClick={handleEntry}>
          {props.loginText ?? '登录'}
        </button>
      </div>
      {dialog}
    </>
  );
}

export const LoginMaterial = defineMaterial<LoginProps>({
  Component: Login,
  meta: defineMeta({
    name: 'Login',
    version: '1.1.0',
    title: '登录',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'user',
    description: '点击弹出账号密码框，提交抛 submit 事件；已登录展示头像昵称',
    defaultProps: {
      mode: 'dialog',
      localSession: true,
      loginText: '登录',
      tip: '登录后参与活动',
      showAvatar: true,
      showLogout: true,
      logoutText: '退出',
      dialogTitle: '登录',
      accountLabel: '账号',
      accountPlaceholder: '请输入账号',
      passwordLabel: '密码',
      passwordPlaceholder: '请输入密码',
      submitText: '登录',
      cancelText: '取消',
      fontSize: 26,
      color: '#333333',
      buttonColor: '#1677ff',
      buttonTextColor: '#ffffff',
      avatarSize: 72,
    },
    events: [
      { name: 'login', label: '点击登录入口', payloadKeys: [] },
      { name: 'submit', label: '提交账号密码', payloadKeys: ['username', 'password'] },
      { name: 'logout', label: '点击退出', payloadKeys: [] },
    ],
    propsSchema: [
      prop({
        key: 'mode',
        label: '登录形态',
        editor: 'radio',
        options: [
          { label: '账号密码弹窗', value: 'dialog' },
          { label: '交给登录动作', value: 'action' },
        ],
        help: '选「交给登录动作」时不弹窗，只抛 login 事件，由宿主 SDK 拉起登录',
      }),
      prop({
        key: 'logged',
        label: '登录态',
        editor: 'string',
        bindable: true,
        placeholder: '{{ state.userId }}',
        help: '绑定登录后写入的状态或数据源字段，有值即按已登录展示',
      }),
      prop({
        key: 'localSession',
        label: '本地维持登录态',
        editor: 'boolean',
        help: '提交后组件自己记住登录态；接了真实登录接口就关掉，只认上面的绑定',
      }),
      prop({
        key: 'nickname',
        label: '昵称',
        editor: 'string',
        bindable: true,
        placeholder: '{{ state.nickname }}',
        help: '留空则显示提交时填的账号',
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
      prop({
        key: 'dialogTitle',
        label: '弹窗标题',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'accountLabel',
        label: '账号标题',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'accountPlaceholder',
        label: '账号占位文案',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'passwordLabel',
        label: '密码标题',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'passwordPlaceholder',
        label: '密码占位文案',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'submitText',
        label: '提交按钮文案',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'cancelText',
        label: '取消按钮文案',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'errorText',
        label: '未填完提示',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
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

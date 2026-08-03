import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface InviteFriendProps extends CommonStyleProps {
  /** 我的邀请码，通常绑定 {{ state.inviteCode }} */
  inviteCode?: string;
  /** 邀请链接里携带邀请码的参数名 */
  codeParam?: string;
  /** 完整邀请链接；留空则用当前页面地址拼上邀请码 */
  link?: string;
  /** 别人的邀请码，通常绑定 {{ query.inviteCode }}，有值即进入「接受邀请」形态 */
  invitedBy?: string;
  inviterName?: string;
  /** 带邀请码进来自动弹出接受邀请弹窗 */
  autoOpen?: boolean;
  entryText?: string;
  dialogTitle?: string;
  tip?: string;
  copyText?: string;
  copiedText?: string;
  copyFailText?: string;
  guestTitle?: string;
  guestTip?: string;
  acceptText?: string;
  declineText?: string;
  acceptedText?: string;
  color?: string;
  fontSize?: number;
  buttonColor?: string;
  buttonImage?: string;
  buttonTextColor?: string;
}

/**
 * 复制到剪贴板。
 *
 * clipboard API 在 H5 里只在 https + 用户手势下可用，微信/端内 webview 还常常
 * 直接没有，所以必须留 execCommand 这条老路；两条都失败时不谎报成功，
 * 让用户去长按弹窗里那个只读输入框自己复制。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 邀请好友。
 *
 * 一个组件担两个角色，因为它们本就是同一条链路的两端：
 * 主人点入口 → 弹窗里拿到带邀请码的链接 → 好友点开链接进来，
 * 组件从 invitedBy 认出自己是被邀请的那一方 → 弹「接受邀请」→ 抛 accept。
 *
 * 邀请关系由 accept 事件接后端建立：谁邀请了谁、能不能重复接受、
 * 有没有刷单，都必须服务端说了算，物料只负责把这一下点击抛出去。
 */
function InviteFriend({
  children: _children,
  emit,
  editing,
  ...props
}: MaterialComponentProps<InviteFriendProps>) {
  const [open, setOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [accepted, setAccepted] = useState(false);
  const emitRef = useRef(emit);
  emitRef.current = emit;

  const code = props.inviteCode ?? '';
  const invitedBy = props.invitedBy ?? '';
  /** 自己的链接自己点开不算被邀请，否则一刷新就自我邀请 */
  const isGuest = invitedBy !== '' && invitedBy !== code;

  const link = (() => {
    if (props.link) return props.link;
    if (typeof window === 'undefined') return '';
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(props.codeParam || 'inviteCode', code);
      return url.toString();
    } catch {
      return '';
    }
  })();

  // 好友带着邀请码进来，自动把弹窗顶到面前，不指望他去找入口
  useEffect(() => {
    if (!isGuest || accepted || editing) return;
    if (props.autoOpen === false) return;
    setGuestOpen(true);
  }, [isGuest, accepted, editing, props.autoOpen]);

  const fontSize = dp(props.fontSize ?? 26);
  const color = props.color || '#333333';
  const primaryStyle: CSSProperties = {
    backgroundImage: props.buttonImage ? `url(${props.buttonImage})` : undefined,
    backgroundColor: props.buttonImage ? 'transparent' : props.buttonColor || '#ff4d4f',
    color: props.buttonTextColor || '#ffffff',
    fontSize,
  };

  const handleCopy = async () => {
    const ok = await copyText(link);
    setCopied(ok);
    emitRef.current?.('copy', { link, ok });
  };

  const inviteDialog = open && (
    <div className="nca-dialog" onClick={() => setOpen(false)}>
      <div className="nca-dialog__panel" onClick={(e) => e.stopPropagation()}>
        <div className="nca-dialog__title">{props.dialogTitle ?? '邀请好友'}</div>
        <div className="nca-invite__tip">
          {props.tip ?? '把链接发给好友，好友接受邀请后即可算作你的助力'}
        </div>
        {/* 只读输入框而不是纯文本：复制失败时还能长按选中，这在端内 webview 是常态 */}
        <input className="nca-dialog__input nca-invite__link" readOnly value={link} />
        <div className="nca-dialog__footer">
          <button
            type="button"
            className="nca-dialog__btn nca-dialog__btn--primary"
            style={primaryStyle}
            onClick={handleCopy}
          >
            {copied === null
              ? (props.copyText ?? '复制链接')
              : copied
                ? (props.copiedText ?? '已复制')
                : (props.copyFailText ?? '复制失败，请长按链接')}
          </button>
        </div>
      </div>
    </div>
  );

  const guestDialog = guestOpen && (
    <div className="nca-dialog">
      <div className="nca-dialog__panel">
        <div className="nca-dialog__title">
          {props.inviterName
            ? `${props.inviterName} ${props.guestTitle ?? '邀请你一起参加活动'}`
            : (props.guestTitle ?? '好友邀请你一起参加活动')}
        </div>
        <div className="nca-invite__tip">
          {props.guestTip ?? '接受邀请后，你和好友都能获得奖励'}
        </div>
        <div className="nca-dialog__footer">
          <button
            type="button"
            className="nca-dialog__btn"
            onClick={() => {
              setGuestOpen(false);
              emit?.('decline');
            }}
          >
            {props.declineText ?? '再逛逛'}
          </button>
          <button
            type="button"
            className="nca-dialog__btn nca-dialog__btn--primary"
            style={primaryStyle}
            onClick={() => {
              setAccepted(true);
              setGuestOpen(false);
              emit?.('accept', { code: invitedBy, inviter: props.inviterName });
            }}
          >
            {props.acceptText ?? '接受邀请'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="nca-invite" style={mergeStyle(commonStyle(props), { color, fontSize })}>
        {accepted ? (
          <span className="nca-invite__accepted">{props.acceptedText ?? '已接受好友邀请'}</span>
        ) : (
          <button
            type="button"
            className="nca-invite__btn"
            style={primaryStyle}
            onClick={() => {
              emit?.('invite');
              // 编辑态不弹：画布里的点击本就被交互层拦着，弹出来也只会挡住页面
              if (editing) return;
              setCopied(null);
              setOpen(true);
            }}
          >
            {props.entryText ?? '邀请好友'}
          </button>
        )}
      </div>
      {inviteDialog}
      {guestDialog}
    </>
  );
}

export const InviteFriendMaterial = defineMaterial<InviteFriendProps>({
  Component: InviteFriend,
  meta: defineMeta({
    name: 'InviteFriend',
    version: '1.0.0',
    title: '邀请好友',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'share',
    description: '点击弹出邀请链接可复制；好友带邀请码进来自动弹窗，接受后抛 accept 事件',
    defaultProps: {
      codeParam: 'inviteCode',
      autoOpen: true,
      entryText: '邀请好友',
      dialogTitle: '邀请好友',
      tip: '把链接发给好友，好友接受邀请后即可算作你的助力',
      copyText: '复制链接',
      copiedText: '已复制',
      copyFailText: '复制失败，请长按链接',
      guestTitle: '邀请你一起参加活动',
      guestTip: '接受邀请后，你和好友都能获得奖励',
      acceptText: '接受邀请',
      declineText: '再逛逛',
      acceptedText: '已接受好友邀请',
      fontSize: 26,
      color: '#333333',
      buttonColor: '#ff4d4f',
      buttonTextColor: '#ffffff',
    },
    events: [
      { name: 'invite', label: '点击邀请入口', payloadKeys: [] },
      { name: 'copy', label: '复制邀请链接', payloadKeys: ['link', 'ok'] },
      { name: 'accept', label: '接受邀请', payloadKeys: ['code', 'inviter'] },
      { name: 'decline', label: '拒绝邀请', payloadKeys: [] },
    ],
    propsSchema: [
      prop({
        key: 'inviteCode',
        label: '我的邀请码',
        editor: 'string',
        bindable: true,
        placeholder: '{{ state.inviteCode }}',
        help: '拼进邀请链接，通常来自登录后返回的用户信息',
      }),
      prop({
        key: 'invitedBy',
        label: '好友的邀请码',
        editor: 'string',
        bindable: true,
        placeholder: '{{ query.inviteCode }}',
        help: '有值即认为当前用户是被邀请进来的，会弹出接受邀请弹窗',
      }),
      prop({
        key: 'inviterName',
        label: '邀请人昵称',
        editor: 'string',
        bindable: true,
        placeholder: '{{ dataSource.inviter.name }}',
      }),
      prop({ key: 'codeParam', label: '链接参数名', editor: 'string' }),
      prop({
        key: 'link',
        label: '自定义邀请链接',
        editor: 'string',
        bindable: true,
        help: '留空则用当前页面地址拼上邀请码',
      }),
      prop({ key: 'autoOpen', label: '被邀请时自动弹窗', editor: 'boolean' }),
      prop({ key: 'entryText', label: '入口按钮文案', editor: 'string' }),
      prop({ key: 'dialogTitle', label: '邀请弹窗标题', editor: 'string' }),
      prop({ key: 'tip', label: '邀请弹窗说明', editor: 'textarea' }),
      prop({ key: 'copyText', label: '复制按钮文案', editor: 'string' }),
      prop({ key: 'copiedText', label: '复制成功文案', editor: 'string' }),
      prop({ key: 'copyFailText', label: '复制失败文案', editor: 'string' }),
      prop({ key: 'guestTitle', label: '接受弹窗标题', editor: 'string' }),
      prop({ key: 'guestTip', label: '接受弹窗说明', editor: 'textarea' }),
      prop({ key: 'acceptText', label: '接受按钮文案', editor: 'string' }),
      prop({ key: 'declineText', label: '拒绝按钮文案', editor: 'string' }),
      prop({ key: 'acceptedText', label: '已接受文案', editor: 'string' }),
      styleProp({ key: 'buttonImage', label: '按钮图', editor: 'image' }),
      styleProp({ key: 'buttonColor', label: '按钮底色', editor: 'color' }),
      styleProp({ key: 'buttonTextColor', label: '按钮文字色', editor: 'color' }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 100 }),
      ...commonStyleSchema,
    ],
  }),
});

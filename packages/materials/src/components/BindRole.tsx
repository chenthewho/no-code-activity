import { useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface BindRoleProps extends CommonStyleProps {
  /** 区服列表，可直接配置，也可绑定 {{ dataSource.servers }} */
  servers?: (Record<string, unknown> | string)[];
  /** 角色列表。带了「所属区服」字段的项会按已选区服过滤 */
  roles?: (Record<string, unknown> | string)[];
  labelKey?: string;
  valueKey?: string;
  roleServerKey?: string;
  /** 已绑定角色名，有值即展示已绑定态，通常绑定 {{ dataSource.bound.roleName }} */
  boundRole?: string;
  boundServer?: string;
  /** 确认后本地即视为已绑定。接了真实绑定接口就关掉，只认上面的绑定值 */
  localBinding?: boolean;
  boundTip?: string;
  entryText?: string;
  switchText?: string;
  showSwitch?: boolean;
  dialogTitle?: string;
  serverLabel?: string;
  roleLabel?: string;
  serverPlaceholder?: string;
  rolePlaceholder?: string;
  emptyRoleText?: string;
  confirmText?: string;
  cancelText?: string;
  color?: string;
  fontSize?: number;
  fieldColor?: string;
  fieldRadius?: number;
  buttonColor?: string;
  buttonImage?: string;
  buttonTextColor?: string;
}

interface Option {
  label: string;
  value: string;
  raw: unknown;
}

/** 兼容两种配法：对象数组按字段映射取值，纯字符串数组直接当选项 */
function toOptions(
  list: (Record<string, unknown> | string)[],
  labelKey: string,
  valueKey: string,
): Option[] {
  return list.map((item, i) => {
    if (typeof item === 'string') return { label: item, value: item, raw: item };
    return {
      label: String(item?.[labelKey] ?? ''),
      value: String(item?.[valueKey] ?? i),
      raw: item,
    };
  });
}

/**
 * 绑定游戏角色：点入口 → 弹窗里选区服选角色 → 确认。
 *
 * 入口收成一个按钮而不是把两个下拉平铺在页面上：活动页寸土寸金，
 * 绑定是一次性动作，绑完之后那两个下拉就只是噪音了。
 *
 * 角色列表有两种来法。接口场景是「选中区服 → 刷新角色数据源」；
 * 纯静态配置则给每个角色标上所属区服（roleServerKey），组件自己过滤——
 * 否则静态配的角色会不分区服全都列出来，选完提交的还是别区的角色。
 */
function BindRole({
  children: _children,
  emit,
  editing,
  ...props
}: MaterialComponentProps<BindRoleProps>) {
  const labelKey = props.labelKey || 'name';
  const valueKey = props.valueKey || 'id';
  const roleServerKey = props.roleServerKey || 'serverId';

  const [open, setOpen] = useState(false);
  const [serverValue, setServerValue] = useState('');
  const [roleValue, setRoleValue] = useState('');
  /** 本地绑定态，仅在 localBinding 打开时生效 */
  const [bound, setBound] = useState<{ server: string; role: string } | null>(null);

  const serverOptions = toOptions(
    Array.isArray(props.servers) ? props.servers : [],
    labelKey,
    valueKey,
  );
  const currentServer = serverOptions.some((o) => o.value === serverValue) ? serverValue : '';

  const roleSource = (Array.isArray(props.roles) ? props.roles : []).filter((item) => {
    if (typeof item === 'string') return true;
    const owner = item?.[roleServerKey];
    // 没标所属区服的角色一律展示，留给「按区服刷新数据源」那条路
    if (owner === undefined || owner === null || owner === '') return true;
    return String(owner) === currentServer;
  });
  const roleOptions = toOptions(roleSource, labelKey, valueKey);
  // 角色列表换了（多半是切了区服）之后，旧的选中值不该还留在框里
  const currentRole = roleOptions.some((o) => o.value === roleValue) ? roleValue : '';

  const fontSize = dp(props.fontSize ?? 26);
  const color = props.color || '#333333';
  const rootStyle = mergeStyle(commonStyle(props), { color, fontSize });
  const fieldStyle: CSSProperties = {
    backgroundColor: props.fieldColor || '#f5f5f5',
    borderRadius: dp(props.fieldRadius ?? 8),
    color,
    fontSize,
  };
  const primaryStyle: CSSProperties = {
    backgroundImage: props.buttonImage ? `url(${props.buttonImage})` : undefined,
    backgroundColor: props.buttonImage ? 'transparent' : props.buttonColor || '#1677ff',
    color: props.buttonTextColor || '#ffffff',
    borderRadius: dp(props.fieldRadius ?? 8),
    fontSize,
  };

  const boundServer = props.boundRole ? props.boundServer : bound?.server;
  const boundRole = props.boundRole || (props.localBinding !== false ? bound?.role : undefined);

  const openDialog = () => {
    emit?.('switch');
    // 编辑态不弹：画布里的点击本就被交互层拦着，弹出来也只会挡住页面
    if (editing) return;
    setOpen(true);
  };

  const handleConfirm = () => {
    if (!currentRole) return;
    const server = serverOptions.find((o) => o.value === currentServer);
    const role = roleOptions.find((o) => o.value === currentRole);
    emit?.('bind', {
      serverId: currentServer,
      roleId: currentRole,
      server: server?.raw,
      role: role?.raw,
    });
    if (props.localBinding !== false) {
      setBound({ server: server?.label ?? '', role: role?.label ?? '' });
    }
    setOpen(false);
  };

  const dialog = open && (
    <div className="nca-dialog" onClick={() => setOpen(false)}>
      <div className="nca-dialog__panel" onClick={(e) => e.stopPropagation()}>
        <div className="nca-dialog__title">{props.dialogTitle ?? '绑定角色'}</div>

        <label className="nca-dialog__field">
          <span className="nca-dialog__label">{props.serverLabel ?? '区服'}</span>
          <select
            className="nca-dialog__input nca-bind-role__select"
            style={fieldStyle}
            value={currentServer}
            onChange={(e) => {
              const value = e.target.value;
              setServerValue(value);
              // 区服一换，之前选的角色必然不属于新区服
              setRoleValue('');
              emit?.('serverChange', {
                serverId: value,
                server: serverOptions.find((o) => o.value === value)?.raw,
              });
            }}
          >
            <option value="" disabled>
              {props.serverPlaceholder ?? '请选择区服'}
            </option>
            {serverOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="nca-dialog__field">
          <span className="nca-dialog__label">{props.roleLabel ?? '角色'}</span>
          <select
            className="nca-dialog__input nca-bind-role__select"
            style={fieldStyle}
            value={currentRole}
            disabled={roleOptions.length === 0}
            onChange={(e) => {
              const value = e.target.value;
              setRoleValue(value);
              emit?.('roleChange', {
                roleId: value,
                role: roleOptions.find((o) => o.value === value)?.raw,
              });
            }}
          >
            <option value="" disabled>
              {roleOptions.length === 0
                ? (props.emptyRoleText ?? '请先选择区服')
                : (props.rolePlaceholder ?? '请选择角色')}
            </option>
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="nca-dialog__footer">
          <button type="button" className="nca-dialog__btn" onClick={() => setOpen(false)}>
            {props.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className="nca-dialog__btn nca-dialog__btn--primary"
            style={primaryStyle}
            disabled={!currentRole}
            onClick={handleConfirm}
          >
            {props.confirmText ?? '确认绑定'}
          </button>
        </div>
      </div>
    </div>
  );

  if (boundRole) {
    return (
      <>
        <div className="nca-bind-role nca-bind-role--bound" style={rootStyle}>
          <span className="nca-bind-role__tip">{props.boundTip ?? '当前角色'}</span>
          <span className="nca-bind-role__name">
            {boundServer ? `${boundServer} · ` : ''}
            {boundRole}
          </span>
          {props.showSwitch !== false && (
            <button
              type="button"
              className="nca-bind-role__switch"
              style={{ color, fontSize }}
              onClick={openDialog}
            >
              {props.switchText ?? '换绑'}
            </button>
          )}
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className="nca-bind-role" style={rootStyle}>
        <button
          type="button"
          className="nca-bind-role__entry"
          style={primaryStyle}
          onClick={openDialog}
        >
          {props.entryText ?? '绑定角色'}
        </button>
      </div>
      {dialog}
    </>
  );
}

export const BindRoleMaterial = defineMaterial<BindRoleProps>({
  Component: BindRole,
  meta: defineMeta({
    name: 'BindRole',
    version: '1.1.0',
    title: '绑定角色',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'id-card',
    description: '点按钮弹出区服与角色下拉，确认后展示已绑定角色，支持换绑',
    defaultProps: {
      labelKey: 'name',
      valueKey: 'id',
      roleServerKey: 'serverId',
      localBinding: true,
      entryText: '绑定角色',
      dialogTitle: '绑定角色',
      serverLabel: '区服',
      roleLabel: '角色',
      serverPlaceholder: '请选择区服',
      rolePlaceholder: '请选择角色',
      emptyRoleText: '请先选择区服',
      confirmText: '确认绑定',
      cancelText: '取消',
      boundTip: '当前角色',
      showSwitch: true,
      switchText: '换绑',
      fontSize: 26,
      color: '#333333',
      fieldColor: '#f5f5f5',
      fieldRadius: 8,
      buttonColor: '#1677ff',
      buttonTextColor: '#ffffff',
    },
    events: [
      { name: 'switch', label: '唤起绑定弹窗', payloadKeys: [] },
      { name: 'serverChange', label: '选中区服', payloadKeys: ['serverId', 'server'] },
      { name: 'roleChange', label: '选中角色', payloadKeys: ['roleId', 'role'] },
      { name: 'bind', label: '确认绑定', payloadKeys: ['serverId', 'roleId', 'server', 'role'] },
    ],
    propsSchema: [
      prop({
        key: 'servers',
        label: '区服列表',
        editor: 'json',
        bindable: true,
        help: '数组，每项 { id, name }；也可绑定 {{ dataSource.servers }}',
      }),
      prop({
        key: 'roles',
        label: '角色列表',
        editor: 'json',
        bindable: true,
        help: '每项 { id, name, serverId }；标了 serverId 就按区服过滤，不标则由数据源按区服刷新',
      }),
      prop({ key: 'labelKey', label: '名称字段', editor: 'string' }),
      prop({ key: 'valueKey', label: '值字段', editor: 'string' }),
      prop({ key: 'roleServerKey', label: '角色所属区服字段', editor: 'string' }),
      prop({
        key: 'boundRole',
        label: '已绑定角色',
        editor: 'string',
        bindable: true,
        placeholder: '{{ dataSource.bound.roleName }}',
        help: '有值即展示已绑定态，绑定成功后刷新对应数据源即可',
      }),
      prop({
        key: 'boundServer',
        label: '已绑定区服',
        editor: 'string',
        bindable: true,
        placeholder: '{{ dataSource.bound.serverName }}',
      }),
      prop({
        key: 'localBinding',
        label: '本地维持绑定态',
        editor: 'boolean',
        help: '确认后组件自己记住绑定结果；接了真实绑定接口就关掉，只认上面的绑定值',
      }),
      prop({ key: 'entryText', label: '入口按钮文案', editor: 'string' }),
      prop({ key: 'boundTip', label: '已绑定文案', editor: 'string' }),
      prop({ key: 'showSwitch', label: '允许换绑', editor: 'boolean' }),
      prop({
        key: 'switchText',
        label: '换绑按钮文案',
        editor: 'string',
        visibleWhen: '{{ props.showSwitch }}',
      }),
      prop({ key: 'dialogTitle', label: '弹窗标题', editor: 'string' }),
      prop({ key: 'serverLabel', label: '区服标题', editor: 'string' }),
      prop({ key: 'roleLabel', label: '角色标题', editor: 'string' }),
      prop({ key: 'serverPlaceholder', label: '区服占位文案', editor: 'string' }),
      prop({ key: 'rolePlaceholder', label: '角色占位文案', editor: 'string' }),
      prop({ key: 'emptyRoleText', label: '角色为空文案', editor: 'string' }),
      prop({ key: 'confirmText', label: '确认按钮文案', editor: 'string' }),
      prop({ key: 'cancelText', label: '取消按钮文案', editor: 'string' }),
      styleProp({ key: 'buttonImage', label: '按钮图', editor: 'image' }),
      styleProp({ key: 'buttonColor', label: '按钮底色', editor: 'color' }),
      styleProp({ key: 'buttonTextColor', label: '按钮文字色', editor: 'color' }),
      styleProp({ key: 'fieldColor', label: '选择框底色', editor: 'color' }),
      styleProp({ key: 'fieldRadius', label: '圆角', editor: 'number', min: 0 }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 100 }),
      ...commonStyleSchema,
    ],
  }),
});

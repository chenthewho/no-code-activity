import { useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface BindRoleProps extends CommonStyleProps {
  /** 区服列表，通常绑定 {{ dataSource.servers }} */
  servers?: (Record<string, unknown> | string)[];
  /** 角色列表，通常绑定选完区服后刷新的 {{ dataSource.roles }} */
  roles?: (Record<string, unknown> | string)[];
  labelKey?: string;
  valueKey?: string;
  /** 已绑定角色名，有值即展示已绑定态，通常绑定 {{ dataSource.bound.roleName }} */
  boundRole?: string;
  boundServer?: string;
  boundTip?: string;
  serverLabel?: string;
  roleLabel?: string;
  serverPlaceholder?: string;
  rolePlaceholder?: string;
  emptyRoleText?: string;
  buttonText?: string;
  showSwitch?: boolean;
  switchText?: string;
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
  list: (Record<string, unknown> | string)[] | undefined,
  labelKey: string,
  valueKey: string,
): Option[] {
  if (!Array.isArray(list)) return [];
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
 * 绑定游戏角色：选区服 → 选角色 → 提交。
 *
 * 区服与角色都从数据源来——角色列表依赖已选区服，运营的编排是
 * 「选中区服 → 刷新角色数据源」。物料自己只留选中态，绑定结果由
 * boundRole 绑进来，这样刷新页面后仍然是已绑定态，而不是靠组件内部记忆。
 */
function BindRole({ children: _children, emit, ...props }: MaterialComponentProps<BindRoleProps>) {
  const labelKey = props.labelKey || 'name';
  const valueKey = props.valueKey || 'id';
  const serverOptions = toOptions(props.servers, labelKey, valueKey);
  const roleOptions = toOptions(props.roles, labelKey, valueKey);

  const [serverValue, setServerValue] = useState('');
  const [roleValue, setRoleValue] = useState('');
  const [switching, setSwitching] = useState(false);

  // 角色列表换了（多半是切了区服）之后，旧的选中值不该还留在框里
  const currentRole = roleOptions.some((o) => o.value === roleValue) ? roleValue : '';
  const currentServer = serverOptions.some((o) => o.value === serverValue) ? serverValue : '';

  const fontSize = dp(props.fontSize ?? 26);
  const color = props.color || '#333333';
  const rootStyle = mergeStyle(commonStyle(props), { color, fontSize });
  const fieldStyle: CSSProperties = {
    backgroundColor: props.fieldColor || '#f5f5f5',
    borderRadius: dp(props.fieldRadius ?? 8),
    color,
    fontSize,
  };

  const bound = Boolean(props.boundRole);
  if (bound && !switching) {
    return (
      <div className="nca-bind-role nca-bind-role--bound" style={rootStyle}>
        <span className="nca-bind-role__tip">{props.boundTip ?? '当前角色'}</span>
        <span className="nca-bind-role__name">
          {props.boundServer ? `${props.boundServer} · ` : ''}
          {props.boundRole}
        </span>
        {props.showSwitch !== false && (
          <button
            type="button"
            className="nca-bind-role__switch"
            style={{ color, fontSize }}
            onClick={() => {
              setSwitching(true);
              emit?.('switch');
            }}
          >
            {props.switchText ?? '切换角色'}
          </button>
        )}
      </div>
    );
  }

  const canSubmit = currentRole !== '';

  return (
    <div className="nca-bind-role" style={rootStyle}>
      <label className="nca-bind-role__field">
        <span className="nca-bind-role__label">{props.serverLabel ?? '区服'}</span>
        <select
          className="nca-bind-role__select"
          style={fieldStyle}
          value={currentServer}
          onChange={(e) => {
            const value = e.target.value;
            setServerValue(value);
            // 区服一换，之前选的角色必然不属于新区服
            setRoleValue('');
            const option = serverOptions.find((o) => o.value === value);
            emit?.('serverChange', { serverId: value, server: option?.raw });
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

      <label className="nca-bind-role__field">
        <span className="nca-bind-role__label">{props.roleLabel ?? '角色'}</span>
        <select
          className="nca-bind-role__select"
          style={fieldStyle}
          value={currentRole}
          disabled={roleOptions.length === 0}
          onChange={(e) => {
            const value = e.target.value;
            setRoleValue(value);
            const option = roleOptions.find((o) => o.value === value);
            emit?.('roleChange', { roleId: value, role: option?.raw });
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

      <button
        type="button"
        className="nca-bind-role__submit"
        disabled={!canSubmit}
        style={{
          backgroundImage: props.buttonImage ? `url(${props.buttonImage})` : undefined,
          backgroundColor: props.buttonImage ? 'transparent' : props.buttonColor || '#1677ff',
          color: props.buttonTextColor || '#ffffff',
          borderRadius: dp(props.fieldRadius ?? 8),
          fontSize,
          opacity: canSubmit ? undefined : 0.5,
        }}
        onClick={() => {
          if (!canSubmit) return;
          setSwitching(false);
          emit?.('bind', {
            serverId: currentServer,
            roleId: currentRole,
            server: serverOptions.find((o) => o.value === currentServer)?.raw,
            role: roleOptions.find((o) => o.value === currentRole)?.raw,
          });
        }}
      >
        {props.buttonText ?? '确认绑定'}
      </button>
    </div>
  );
}

export const BindRoleMaterial = defineMaterial<BindRoleProps>({
  Component: BindRole,
  meta: defineMeta({
    name: 'BindRole',
    version: '1.0.0',
    title: '绑定角色',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'id-card',
    description: '选区服选角色并提交绑定，选中区服后抛 serverChange，可接刷新角色数据源',
    defaultProps: {
      labelKey: 'name',
      valueKey: 'id',
      serverLabel: '区服',
      roleLabel: '角色',
      serverPlaceholder: '请选择区服',
      rolePlaceholder: '请选择角色',
      emptyRoleText: '请先选择区服',
      buttonText: '确认绑定',
      boundTip: '当前角色',
      showSwitch: true,
      switchText: '切换角色',
      fontSize: 26,
      color: '#333333',
      fieldColor: '#f5f5f5',
      fieldRadius: 8,
      buttonColor: '#1677ff',
      buttonTextColor: '#ffffff',
    },
    events: [
      { name: 'serverChange', label: '选中区服', payloadKeys: ['serverId', 'server'] },
      { name: 'roleChange', label: '选中角色', payloadKeys: ['roleId', 'role'] },
      { name: 'bind', label: '点击绑定', payloadKeys: ['serverId', 'roleId', 'server', 'role'] },
      { name: 'switch', label: '点击切换角色', payloadKeys: [] },
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
        help: '随已选区服变化，编排「选中区服 → 刷新数据源」后绑定即可',
      }),
      prop({ key: 'labelKey', label: '名称字段', editor: 'string' }),
      prop({ key: 'valueKey', label: '值字段', editor: 'string' }),
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
      prop({ key: 'boundTip', label: '已绑定文案', editor: 'string' }),
      prop({ key: 'showSwitch', label: '允许切换角色', editor: 'boolean' }),
      prop({
        key: 'switchText',
        label: '切换按钮文案',
        editor: 'string',
        visibleWhen: '{{ props.showSwitch }}',
      }),
      prop({ key: 'serverLabel', label: '区服标题', editor: 'string' }),
      prop({ key: 'roleLabel', label: '角色标题', editor: 'string' }),
      prop({ key: 'serverPlaceholder', label: '区服占位文案', editor: 'string' }),
      prop({ key: 'rolePlaceholder', label: '角色占位文案', editor: 'string' }),
      prop({ key: 'emptyRoleText', label: '角色为空文案', editor: 'string' }),
      prop({ key: 'buttonText', label: '按钮文案', editor: 'string' }),
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

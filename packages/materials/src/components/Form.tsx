import { useState, type CSSProperties, type ReactNode } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface FormField {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

export interface FormProps extends CommonStyleProps {
  title?: string;
  description?: string;
  /** 表单字段配置，运营在设置器「属性」面板以 JSON 编辑 */
  fields?: FormField[];
  submitText?: string;
  buttonColor?: string;
}

/**
 * 表单物料。输入值保存在组件内部 state，提交时统一校验并 emit('submit', { values })，
 * 运营把「提交」事件绑到 form.submit 动作即可上报到 POST /runtime/forms。
 */
function Form({ children: _children, emit, ...props }: MaterialComponentProps<FormProps>) {
  const fields = Array.isArray(props.fields) ? props.fields : [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.key] ?? '';
      if (field.required && !value.trim()) {
        next[field.key] = `请填写${field.label}`;
      } else if (field.type === 'number' && value && Number.isNaN(Number(value))) {
        next[field.key] = `${field.label}需为数字`;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    emit?.('submit', { values });
    setValues({});
    setErrors({});
  };

  const inputStyle = (hasError: boolean): CSSProperties => ({
    width: '100%',
    boxSizing: 'border-box',
    padding: dp(20),
    borderRadius: dp(8),
    border: hasError ? '1px solid #ff4d4f' : '1px solid #d9d9d9',
    fontSize: dp(26),
    outline: 'none',
  });

  const renderField = (field: FormField): ReactNode => {
    const value = values[field.key] ?? '';
    const hasError = Boolean(errors[field.key]);
    const style = inputStyle(hasError);

    let control: ReactNode;
    if (field.type === 'textarea') {
      control = (
        <textarea
          style={{ ...style, minHeight: dp(160), fontFamily: 'inherit' }}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => setValue(field.key, e.target.value)}
        />
      );
    } else if (field.type === 'select') {
      control = (
        <select style={style} value={value} onChange={(e) => setValue(field.key, e.target.value)}>
          <option value="">{field.placeholder ?? '请选择'}</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    } else if (field.type === 'date') {
      control = (
        <input type="date" style={style} value={value} onChange={(e) => setValue(field.key, e.target.value)} />
      );
    } else if (field.type === 'number') {
      control = (
        <input
          type="number"
          style={style}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => setValue(field.key, e.target.value)}
        />
      );
    } else {
      control = (
        <input
          type="text"
          style={style}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => setValue(field.key, e.target.value)}
        />
      );
    }

    return (
      <label key={field.key} style={{ display: 'block', marginBottom: dp(24), textAlign: 'left' }}>
        <span style={{ display: 'block', marginBottom: dp(10), fontSize: dp(26), color: '#333' }}>
          {field.label}
          {field.required && <span style={{ color: '#ff4d4f' }}> *</span>}
        </span>
        {control}
        {hasError && (
          <span style={{ display: 'block', marginTop: dp(6), fontSize: dp(22), color: '#ff4d4f' }}>
            {errors[field.key]}
          </span>
        )}
      </label>
    );
  };

  return (
    <div
      style={mergeStyle(commonStyle(props), {
        padding: dp(32),
        backgroundColor: '#fff',
        borderRadius: dp(12),
      })}
    >
      {props.title ? (
        <div style={{ fontSize: dp(36), fontWeight: 'bold', color: '#333', marginBottom: dp(12) }}>
          {props.title}
        </div>
      ) : null}
      {props.description ? (
        <div style={{ fontSize: dp(26), color: '#888', marginBottom: dp(24) }}>{props.description}</div>
      ) : null}
      {fields.length === 0 ? (
        <div style={{ color: '#bbb', fontSize: dp(26), textAlign: 'center', padding: dp(40) }}>
          在设置器里配置表单字段（fields）
        </div>
      ) : (
        fields.map(renderField)
      )}
      <button
        type="button"
        className="nca-form__submit"
        style={{
          width: '100%',
          padding: dp(22),
          borderRadius: dp(10),
          border: 'none',
          fontSize: dp(30),
          color: '#fff',
          backgroundColor: props.buttonColor || '#1677ff',
        }}
        onClick={handleSubmit}
      >
        {props.submitText ?? '提交'}
      </button>
    </div>
  );
}

export const FormMaterial = defineMaterial<FormProps>({
  Component: Form,
  meta: defineMeta({
    name: 'Form',
    version: '1.0.0',
    title: '表单',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'form',
    description: '收集用户输入：字段在「属性」面板以 JSON 配置，提交事件可绑定 form.submit 动作上报到服务端',
    defaultProps: {
      title: '报名表单',
      fields: [
        { key: 'name', label: '姓名', type: 'text', required: true, placeholder: '请输入姓名' },
        { key: 'phone', label: '手机号', type: 'number', required: true, placeholder: '请输入手机号' },
      ],
      submitText: '提交报名',
      buttonColor: '#1677ff',
    },
    events: [{ name: 'submit', label: '提交成功', payloadKeys: ['values'] }],
    propsSchema: [
      prop({ key: 'title', label: '表单标题', editor: 'string' }),
      prop({ key: 'description', label: '说明文字', editor: 'textarea' }),
      prop({
        key: 'fields',
        label: '表单字段',
        editor: 'json',
        help: '数组，每项 { key, label, type: text/textarea/number/date/select, required, placeholder, options }',
      }),
      prop({ key: 'submitText', label: '提交按钮文案', editor: 'string', bindable: true }),
      styleProp({ key: 'buttonColor', label: '按钮颜色', editor: 'color' }),
      ...commonStyleSchema,
    ],
  }),
});

import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Radio, Space, Tag, Typography } from 'antd';
import type { AiInterrupt, AiResume } from '@nca/shared';

interface Props {
  card: AiInterrupt;
  busy: boolean;
  onSubmit: (resume: AiResume) => void;
}

/**
 * 中断卡片。
 *
 * why / done / missing 三行不是装饰：每张卡片都要说清「为什么需要你」
 * 「AI 已经做了什么」「还缺什么」。语焉不详的确认框和假进度条一样，
 * 都在消耗信任，而 AI 产品的信任是一点点建立起来的。
 */
export function InterruptCard({ card, busy, onSubmit }: Props) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<string[]>([]);

  useEffect(() => {
    setFields(Object.fromEntries((card.fields ?? []).map((f) => [f.key, f.value])));
    // 自动注入的默认勾上——它们是业务规则决定必须有的，默认不勾等于让运营
    // 每次都得重新发现一遍「原来抽奖得先登录」
    setChoices((card.options ?? []).filter((o) => o.autoInjected).map((o) => o.value));
  }, [card]);

  const missingRequired = (card.fields ?? []).some((f) => f.required && !fields[f.key]?.trim());

  return (
    <div
      style={{
        border: `1px solid ${card.dangerous ? '#ffccc7' : '#f0f0f0'}`,
        background: card.dangerous ? '#fff2f0' : '#fff',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <Typography.Text strong style={{ fontSize: 14 }}>
        {card.title}
      </Typography.Text>

      <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6 }}>{card.why}</div>
      {card.done && (
        <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>✓ {card.done}</div>
      )}
      {card.missing && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8, fontSize: 12 }}
          message={card.missing}
        />
      )}

      {card.kind === 'edit' && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={8}>
          {(card.fields ?? []).map((field) => (
            <div key={field.key}>
              <div style={{ fontSize: 12, color: '#595959', marginBottom: 4 }}>
                {field.label}
                {field.required && <span style={{ color: '#ff4d4f' }}> *</span>}
              </div>
              {field.type === 'textarea' ? (
                <Input.TextArea
                  rows={2}
                  value={fields[field.key] ?? ''}
                  onChange={(e) => setFields((p) => ({ ...p, [field.key]: e.target.value }))}
                />
              ) : (
                <Input
                  size="small"
                  value={fields[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => setFields((p) => ({ ...p, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </Space>
      )}

      {card.kind === 'respond' && card.multiple && (
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}
          value={choices}
          onChange={(v) => setChoices(v as string[])}
        >
          {(card.options ?? []).map((option) => (
            <Checkbox key={option.value} value={option.value}>
              {option.label}
              {option.autoInjected && (
                <Tag color="blue" style={{ marginLeft: 6 }}>
                  已自动注入
                </Tag>
              )}
              {option.description && (
                <div style={{ fontSize: 12, color: '#bfbfbf' }}>{option.description}</div>
              )}
            </Checkbox>
          ))}
        </Checkbox.Group>
      )}

      {card.kind === 'respond' && !card.multiple && (
        <Radio.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}
          value={choices[0] ?? ''}
          onChange={(e) => setChoices([e.target.value as string])}
        >
          {(card.options ?? []).map((option) => (
            <Radio key={option.value} value={option.value}>
              {option.label}
              {option.description && (
                <div style={{ fontSize: 12, color: '#bfbfbf' }}>{option.description}</div>
              )}
            </Radio>
          ))}
        </Radio.Group>
      )}

      {card.kind === 'approve' && card.patches && card.patches.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: '#595959' }}>
          {card.patches.map((p, i) => (
            <li key={i}>{p.text}</li>
          ))}
        </ul>
      )}

      <Space style={{ marginTop: 14 }}>
        <Button
          type="primary"
          size="small"
          danger={card.dangerous}
          loading={busy}
          disabled={missingRequired}
          onClick={() =>
            onSubmit(
              card.kind === 'edit'
                ? { decision: 'edit', fields }
                : card.kind === 'respond'
                  ? { decision: 'respond', choices }
                  : { decision: 'approve' },
            )
          }
        >
          {card.dangerous ? '确认发布' : card.kind === 'approve' ? '确认' : '下一步'}
        </Button>
        {card.kind === 'approve' && (
          <Button size="small" disabled={busy} onClick={() => onSubmit({ decision: 'reject' })}>
            {card.dangerous ? '先不发布' : '重做'}
          </Button>
        )}
      </Space>
    </div>
  );
}

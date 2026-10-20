import { Form, Input, InputNumber, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { GrayRule } from '@nca/shared';
import { channelApi } from '../api';

/** 表单里的灰度规则：白名单在界面上是多行文本，提交前再拆成数组 */
export interface GrayRuleValues {
  percent: number;
  channels: string[];
  userIdsText: string;
}

export function toGrayRule(values: GrayRuleValues): GrayRule {
  return {
    percent: values.percent ?? 0,
    channels: values.channels ?? [],
    userIds: (values.userIdsText ?? '')
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function fromGrayRule(rule: GrayRule | null | undefined): GrayRuleValues {
  return {
    percent: rule?.percent ?? 10,
    channels: rule?.channels ?? [],
    userIdsText: (rule?.userIds ?? []).join('\n'),
  };
}

/**
 * 灰度规则的三项条件，任一命中即看灰度版：放在发布弹窗与「调整灰度」里共用。
 * 字段名在外层 Form 的 namePrefix 下，调用方自己决定挂在哪。
 */
export function GrayRuleFields({
  activityId,
  name = [],
}: {
  activityId: string;
  name?: (string | number)[];
}) {
  const { data: channels = [] } = useQuery({
    queryKey: ['channels', activityId],
    queryFn: () => channelApi.list(activityId),
  });
  return (
    <>
      <Form.Item
        label="放量比例"
        extra="按设备分桶，同一台设备放量期间始终落在同一边；从 10% 放到 30% 时，原来那 10% 的人不会被换掉"
      >
        <Space.Compact>
          <Form.Item noStyle name={[...name, 'percent']}>
            <InputNumber min={0} max={100} style={{ width: 120 }} />
          </Form.Item>
          <Input style={{ width: 40 }} value="%" disabled />
        </Space.Compact>
      </Form.Item>
      <Form.Item
        label="渠道"
        name={[...name, 'channels']}
        extra="带这些渠道码（?ch=）访问的人看灰度版，适合先给内部测试渠道看"
      >
        <Select
          mode="tags"
          placeholder="选择或输入渠道码"
          options={channels.map((c) => ({ value: c.code, label: `${c.name}（${c.code}）` }))}
        />
      </Form.Item>
      <Form.Item
        label="白名单"
        name={[...name, 'userIdsText']}
        extra="C 端登录用户 id 或访客 id（guest_ 开头，测试同学可在活动页控制台执行 localStorage['nca:guest-id'] 查看），每行一个"
      >
        <Input.TextArea rows={3} placeholder={'ru_xxx\nguest_xxx'} />
      </Form.Item>
    </>
  );
}

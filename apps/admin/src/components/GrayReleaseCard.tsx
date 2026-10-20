import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Modal,
  Popconfirm,
  Space,
  Tag,
  message,
} from 'antd';
import { DashboardOutlined, RocketOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { activityApi, type ActivityDetail } from '../api';
import { GrayRuleFields, fromGrayRule, toGrayRule, type GrayRuleValues } from './GrayRuleFields';

/**
 * 进行中的灰度：看规则、调范围、转全量、停止。
 * 转全量与停止都只切指针，秒级生效；灰度版本的快照留在发布历史里。
 */
export function GrayReleaseCard({
  activity,
  canPublish,
  canMonitor,
}: {
  activity: ActivityDetail;
  canPublish: boolean;
  canMonitor: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<GrayRuleValues>();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['activity', activity.id] });
    void queryClient.invalidateQueries({ queryKey: ['versions', activity.id] });
  };
  const onError = (err: Error) => void message.error(err.message);

  const update = useMutation({
    mutationFn: async () =>
      activityApi.updateGray(activity.id, toGrayRule(await form.validateFields())),
    onSuccess: () => {
      void message.success('灰度范围已调整');
      setEditing(false);
      refresh();
    },
    onError,
  });
  const promote = useMutation({
    mutationFn: () => activityApi.promoteGray(activity.id),
    onSuccess: (result) => {
      void message.success(`v${result.version} 已全量`);
      refresh();
    },
    onError,
  });
  const stop = useMutation({
    mutationFn: () => activityApi.stopGray(activity.id),
    onSuccess: () => {
      void message.success('已停止灰度，所有人回到全量版本');
      refresh();
    },
    onError,
  });

  if (!activity.grayVersion || !activity.grayRule) return null;
  const rule = activity.grayRule;

  return (
    <Card
      title={
        <Space>
          <RocketOutlined />
          灰度发布中
          <Tag color="processing">v{activity.grayVersion}</Tag>
          <span style={{ color: '#8c8c8c', fontWeight: 'normal', fontSize: 13 }}>
            全量版本 v{activity.publishedVersion}
          </span>
        </Space>
      }
      extra={
        <Space>
          {canMonitor && (
            <Button
              icon={<DashboardOutlined />}
              onClick={() => void navigate({ to: '/monitor', search: { activityId: activity.id } })}
            >
              对比新旧版本
            </Button>
          )}
          {canPublish && (
            <>
              <Button
                onClick={() => {
                  form.setFieldsValue(fromGrayRule(rule));
                  setEditing(true);
                }}
              >
                调整范围
              </Button>
              <Popconfirm title="停止灰度？所有人将回到全量版本" onConfirm={() => stop.mutate()}>
                <Button danger loading={stop.isPending}>
                  停止灰度
                </Button>
              </Popconfirm>
              <Popconfirm
                title={`将 v${activity.grayVersion} 全量给所有人？`}
                onConfirm={() => promote.mutate()}
              >
                <Button type="primary" loading={promote.isPending}>
                  转全量
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      }
    >
      <Descriptions size="small" column={3}>
        <Descriptions.Item label="放量比例">{rule.percent}%</Descriptions.Item>
        <Descriptions.Item label="渠道">
          {rule.channels.length > 0 ? rule.channels.map((c) => <Tag key={c}>{c}</Tag>) : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="白名单">
          {rule.userIds.length > 0 ? `${rule.userIds.length} 人` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="开始于">
          {activity.grayStartedAt ? new Date(activity.grayStartedAt).toLocaleString('zh-CN') : '—'}
        </Descriptions.Item>
      </Descriptions>

      <Modal
        title="调整灰度范围"
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={() => update.mutate()}
        confirmLoading={update.isPending}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="只改谁能看到灰度版，不产生新版本；扩大比例时，已在灰度里的人不会被换出去"
        />
        <Form form={form} layout="vertical" size="small">
          <GrayRuleFields activityId={activity.id} />
        </Form>
      </Modal>
    </Card>
  );
}

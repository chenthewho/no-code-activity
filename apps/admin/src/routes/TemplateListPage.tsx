import { useState } from 'react';
import {
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PERMISSION } from '@nca/shared';
import { activityApi, templateApi, type TemplateSummary } from '../api';
import { useAuthStore } from '../stores/auth';
import { PreviewFrame } from '../components/designer/PreviewFrame';

export function TemplateListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);

  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [scope, setScope] = useState<'all' | 'favorite'>('all');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [useTemplate, setUseTemplate] = useState<TemplateSummary | null>(null);
  const [form] = Form.useForm<{ title: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['templates', keyword, category, scope],
    queryFn: () =>
      templateApi.list({
        page: 1,
        pageSize: 60,
        keyword: keyword || undefined,
        category,
        onlyFavorite: scope === 'favorite' || undefined,
      }),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['template-categories'],
    queryFn: templateApi.categories,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const favoriteMutation = useMutation({
    mutationFn: (id: string) => templateApi.toggleFavorite(id),
    onSuccess: (result) => {
      void message.success(result.favorited ? '已收藏' : '已取消收藏');
      void refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => templateApi.disable(id),
    onSuccess: () => {
      void message.success('模板已下架');
      void refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: (values: { title: string }) =>
      activityApi.create({ title: values.title, templateId: useTemplate!.id }),
    onSuccess: (activity) => {
      setUseTemplate(null);
      form.resetFields();
      void message.success('已基于模板创建活动');
      void navigate({ to: '/designer/$activityId', params: { activityId: activity.id } });
    },
    onError: (err: Error) => void message.error(err.message),
  });

  return (
    <Card
      title="模板中心"
      extra={
        <Space>
          <Segmented
            size="small"
            value={scope}
            onChange={(v) => setScope(v as 'all' | 'favorite')}
            options={[
              { label: '全部', value: 'all' },
              { label: '我的收藏', value: 'favorite' },
            ]}
          />
          <Select
            allowClear
            size="small"
            placeholder="全部分类"
            style={{ width: 140 }}
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({ label: c, value: c }))}
          />
          <Input.Search
            allowClear
            placeholder="搜索模板名称"
            style={{ width: 200 }}
            onSearch={setKeyword}
          />
        </Space>
      }
    >
      <List
        loading={isLoading}
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 4 }}
        dataSource={data?.list ?? []}
        locale={{
          emptyText: (
            <Empty
              description={
                scope === 'favorite'
                  ? '还没有收藏的模板'
                  : '还没有模板。在设计器里点「存为模板」即可创建'
              }
            />
          ),
        }}
        renderItem={(item) => (
          <List.Item>
            <Card
              hoverable
              size="small"
              cover={
                <div
                  style={{
                    position: 'relative',
                    height: 160,
                    background: '#fafafa',
                    overflow: 'hidden',
                  }}
                >
                  {item.cover ? (
                    <img
                      alt={item.title}
                      src={item.cover}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        height: '100%',
                        color: '#bfbfbf',
                        fontSize: 12,
                      }}
                    >
                      无封面
                    </div>
                  )}
                  {item.category && (
                    <Tag color="blue" style={{ position: 'absolute', top: 8, left: 8, margin: 0 }}>
                      {item.category}
                    </Tag>
                  )}
                </div>
              }
              actions={[
                <Tooltip key="preview" title="预览模板">
                  <EyeOutlined onClick={() => setPreviewId(item.id)} />
                </Tooltip>,
                <Tooltip key="fav" title={item.favorited ? '取消收藏' : '收藏'}>
                  {item.favorited ? (
                    <StarFilled
                      style={{ color: '#faad14' }}
                      onClick={() => favoriteMutation.mutate(item.id)}
                    />
                  ) : (
                    <StarOutlined onClick={() => favoriteMutation.mutate(item.id)} />
                  )}
                </Tooltip>,
                can(PERMISSION.ACTIVITY_EDIT) ? (
                  <Tooltip key="use" title="用该模板新建活动">
                    <PlusOutlined onClick={() => setUseTemplate(item)} />
                  </Tooltip>
                ) : (
                  <span key="use" />
                ),
                can(PERMISSION.TEMPLATE_MANAGE) ? (
                  <Popconfirm
                    key="del"
                    title="下架该模板？"
                    description="已用它创建的活动不受影响"
                    onConfirm={() => disableMutation.mutate(item.id)}
                  >
                    <DeleteOutlined style={{ color: '#ff4d4f' }} />
                  </Popconfirm>
                ) : (
                  <span key="del" />
                ),
              ]}
            >
              <Card.Meta
                title={item.title}
                description={
                  <Space direction="vertical" size={2} style={{ fontSize: 12 }}>
                    <span style={{ color: '#8c8c8c' }}>{item.description || '暂无说明'}</span>
                    <span style={{ color: '#bfbfbf' }}>
                      使用 {item.useCount} 次 · 收藏 {item.favCount}
                    </span>
                  </Space>
                }
              />
            </Card>
          </List.Item>
        )}
      />

      <TemplatePreviewDrawer id={previewId} onClose={() => setPreviewId(null)} />

      <Modal
        title={`用「${useTemplate?.title ?? ''}」创建活动`}
        open={Boolean(useTemplate)}
        onCancel={() => setUseTemplate(null)}
        onOk={() => void form.submit()}
        confirmLoading={createMutation.isPending}
        okText="创建并进入设计器"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            name="title"
            label="活动名称"
            rules={[{ required: true, message: '请输入活动名称' }]}
          >
            <Input placeholder="如：中秋限定抽奖" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

/**
 * 模板预览。
 *
 * 复用 PreviewFrame，通过 postMessage 把模板 DSL 直接推给渲染器——
 * 模板不是已发布活动，没有公开的 DSL 地址，走消息通道就不必为预览
 * 额外开一个匿名可读的接口。
 */
function TemplatePreviewDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['template', id],
    queryFn: () => templateApi.detail(id!),
    enabled: Boolean(id),
  });

  return (
    <Drawer
      title={data?.title ?? '模板预览'}
      open={Boolean(id)}
      onClose={onClose}
      width={460}
      destroyOnHidden
    >
      {isLoading || !data ? (
        <div style={{ display: 'grid', placeItems: 'center', height: 400 }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {/* 只读预览：关掉指针交互，避免误触发画布的选中逻辑 */}
          <PreviewFrame dsl={data.dsl} width={375} height={667} interactive={false} />
        </div>
      )}
    </Drawer>
  );
}

import { AutoComplete, Form, Input, Modal, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { templateApi } from '../../api';
import { ImagePicker } from './ImagePicker';

interface Props {
  open: boolean;
  activityId: string;
  defaultTitle: string;
  onClose: () => void;
}

interface FormValues {
  title: string;
  category?: string;
  description?: string;
  cover?: string;
}

/**
 * 另存为模板。
 *
 * 服务端会以「活动当前草稿」为准复制，并抹掉活动专属的 meta——
 * 所以这里要提醒运营先保存，否则存进模板的是上一次自动保存的内容。
 */
export function SaveAsTemplateModal({ open, activityId, defaultTitle, onClose }: Props) {
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ['template-categories'],
    queryFn: templateApi.categories,
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => templateApi.saveFrom({ ...values, activityId }),
    onSuccess: () => {
      void message.success('已保存为模板');
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['template-categories'] });
      form.resetFields();
      onClose();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  return (
    <Modal
      title="另存为模板"
      open={open}
      onCancel={onClose}
      onOk={() => void form.submit()}
      confirmLoading={saveMutation.isPending}
      okText="保存为模板"
      destroyOnHidden
    >
      <p style={{ marginTop: 0, color: '#8c8c8c', fontSize: 12 }}>
        以当前草稿为蓝本创建模板。活动时间等专属信息不会被带入。
      </p>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ title: `${defaultTitle} - 模板` }}
        onFinish={(values) => saveMutation.mutate(values)}
      >
        <Form.Item name="title" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
          <Input placeholder="如：抽奖活动通用模板" />
        </Form.Item>
        <Form.Item name="category" label="分类" extra="可直接输入新分类">
          <AutoComplete
            allowClear
            placeholder="如：抽奖 / 签到 / 榜单"
            options={categories.map((c) => ({ value: c }))}
            filterOption={(input, option) => String(option?.value ?? '').includes(input)}
          />
        </Form.Item>
        <Form.Item name="cover" label="封面图" extra="模板中心的卡片封面">
          <ImagePicker />
        </Form.Item>
        <Form.Item name="description" label="模板说明">
          <Input.TextArea rows={3} placeholder="这个模板适合什么场景、包含哪些模块" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

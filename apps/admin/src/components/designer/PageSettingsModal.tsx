import { useEffect } from 'react';
import {
  Alert,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
} from 'antd';
import type { FinalDsl } from '@nca/dsl';
import { HOST_LABELS, HOST_TYPE, type HostType } from '@nca/shared';
import { useDesignerStore } from '../../stores/designer';
import { ImagePicker } from './ImagePicker';

type Meta = FinalDsl['meta'];

interface Values {
  designWidth: number;
  adaptMode: Meta['page']['adaptMode'];
  pageTitle?: string;
  hosts: HostType[];
  loginMode: Meta['auth']['loginMode'];
  loginRequired: boolean;
  shareTitle?: string;
  shareDesc?: string;
  shareCover?: string;
  primaryColor: string;
  backgroundColor: string;
}

const HOST_OPTIONS = Object.values(HOST_TYPE).map((value) => ({
  value,
  label: HOST_LABELS[value],
}));

/**
 * 页面设置：不属于任何组件、作用于整页的配置。
 * 标题和活动时间不在这里改——它们以活动基础信息为准，保存时由服务端盖章。
 */
export function PageSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useDesignerStore((s) => s.dsl.meta);
  const updateMeta = useDesignerStore((s) => s.updateMeta);
  const [form] = Form.useForm<Values>();
  const loginMode = Form.useWatch('loginMode', form);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      designWidth: meta.page.designWidth,
      adaptMode: meta.page.adaptMode,
      pageTitle: meta.page.title,
      hosts: meta.hosts,
      loginMode: meta.auth.loginMode,
      loginRequired: meta.auth.required,
      shareTitle: meta.share.title,
      shareDesc: meta.share.desc,
      shareCover: meta.share.cover,
      primaryColor: meta.theme.primaryColor,
      backgroundColor: meta.theme.backgroundColor,
    });
  }, [form, meta, open]);

  const submit = (values: Values) => {
    // 空串一律当没填：写进 DSL 的空串会过不了 URL/颜色等格式校验
    const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);
    updateMeta({
      page: {
        ...meta.page,
        designWidth: values.designWidth,
        adaptMode: values.adaptMode,
        title: blank(values.pageTitle),
      },
      hosts: values.hosts.length > 0 ? values.hosts : [HOST_TYPE.BROWSER],
      auth: {
        loginMode: values.loginMode,
        // 不登录的活动谈不上「进页面就要登录」
        required: values.loginMode === 'none' ? false : values.loginRequired,
      },
      share: {
        ...meta.share,
        title: blank(values.shareTitle),
        desc: blank(values.shareDesc),
        cover: blank(values.shareCover),
      },
      theme: {
        ...meta.theme,
        primaryColor: values.primaryColor,
        backgroundColor: values.backgroundColor,
      },
    });
    onClose();
  };

  return (
    <Modal
      title="页面设置"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="应用"
      width={560}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" size="small" onFinish={submit}>
        <Divider orientation="left" plain style={{ marginTop: 0 }}>
          页面适配
        </Divider>
        <Form.Item
          label="设计稿宽度"
          name="designWidth"
          extra="竖版活动页通常是 750；SDK 横屏专属页面可按 1334 出稿"
        >
          <InputNumber min={320} max={2560} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="适配方式" name="adaptMode">
          <Radio.Group
            options={[
              { label: '等比缩放（推荐）', value: 'vw' },
              { label: 'rem', value: 'rem' },
              { label: '不缩放（PC）', value: 'fixed' },
            ]}
          />
        </Form.Item>
        <Form.Item label="浏览器标题" name="pageTitle" extra="留空则使用活动名称">
          <Input maxLength={60} />
        </Form.Item>

        <Divider orientation="left" plain>
          投放宿主
        </Divider>
        <Form.Item
          name="hosts"
          extra="同一份页面可投放到多个宿主；只在部分宿主可用的组件，会在发布前提示"
        >
          <Checkbox.Group options={HOST_OPTIONS} />
        </Form.Item>

        <Divider orientation="left" plain>
          参与者登录
        </Divider>
        <Form.Item
          label="登录方式"
          name="loginMode"
          extra="开启后，抽奖、预约、表单提交都只认登录用户，服务端会拒绝访客——按人限次才真正防得住刷"
        >
          <Select
            options={[
              { label: '不需要登录（按访客计数）', value: 'none' },
              { label: '统一登录（浏览器跳转 SSO）', value: 'sso' },
              { label: '宿主登录（SDK / 游戏中心 / 小程序）', value: 'sdk' },
            ]}
          />
        </Form.Item>
        {loginMode && loginMode !== 'none' && (
          <>
            <Form.Item label="进入页面即要求登录" name="loginRequired" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="登录组件可绑定 {{ user.loggedIn }}、{{ user.nickname }}、{{ user.avatar }}，退出按钮绑「退出登录」动作"
            />
          </>
        )}

        <Divider orientation="left" plain>
          分享
        </Divider>
        <Form.Item label="分享标题" name="shareTitle">
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item label="分享描述" name="shareDesc">
          <Input.TextArea maxLength={240} rows={2} />
        </Form.Item>
        <Form.Item label="分享封面" name="shareCover">
          <ImagePicker />
        </Form.Item>

        <Divider orientation="left" plain>
          主题
        </Divider>
        <Form.Item label="主色" name="primaryColor">
          <Input type="color" style={{ width: 80 }} />
        </Form.Item>
        <Form.Item label="页面底色" name="backgroundColor">
          <Input type="color" style={{ width: 80 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

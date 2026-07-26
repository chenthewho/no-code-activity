import { Button, Divider, Segmented, Space, Tag, Tooltip, Upload, message } from 'antd';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EyeOutlined,
  ImportOutlined,
  LoginOutlined,
  SnippetsOutlined,
  MobileOutlined,
  NodeIndexOutlined,
  RedoOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { validateFinalDsl, type FinalDsl } from '@nca/dsl';
import { ROOT_NODE_ID } from '@nca/shared';
import { useDesignerStore } from '../../stores/designer';
import { IssueIndicator } from './IssuePanel';
import type { DslIssue } from '@nca/dsl';

export type DeviceMode = 'desktop' | 'mobile';

interface Props {
  title: string;
  dirty: boolean;
  savedAt: string;
  saving: boolean;
  issues: DslIssue[];
  device: DeviceMode;
  onDeviceChange: (device: DeviceMode) => void;
  onBack: () => void;
  onSave: () => void;
  onPublish: () => void;
  onPreview: () => void;
  onOpenEvents: () => void;
  onSaveAsTemplate: () => void;
}

/**
 * 设计器顶栏。
 *
 * 按「导航 / 编辑操作 / 视图 / 交付」四组排列并用分隔线隔开：
 * 撤销重做删除是高频编辑动作，投放机型与预览属于视图，
 * 保存发布是交付动作，混在一排会让人每次都要重新找。
 */
export function DesignerHeader({
  title,
  dirty,
  savedAt,
  saving,
  issues,
  device,
  onDeviceChange,
  onBack,
  onSave,
  onPublish,
  onPreview,
  onOpenEvents,
  onSaveAsTemplate,
}: Props) {
  const { selectedId, removeNode, undo, redo, past, future, load } = useDesignerStore();

  const canDelete = Boolean(selectedId) && selectedId !== ROOT_NODE_ID;

  /** 导入 DSL：本地文件直接灌进画布，便于迁移与排障 */
  const importDsl = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw: unknown = JSON.parse(String(reader.result));
        const result = validateFinalDsl(raw, { mode: 'draft' });
        if (!result.success) {
          void message.error(`DSL 结构不合法：${result.issues[0]?.message ?? '未知错误'}`);
          return;
        }
        load(result.data as FinalDsl);
        void message.success('DSL 已导入，确认无误后请保存');
      } catch {
        void message.error('文件不是合法的 JSON');
      }
    };
    reader.readAsText(file);
    return false;
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
        paddingInline: 12,
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      {/* 导航 */}
      <Space size={8} style={{ minWidth: 240 }}>
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={onBack} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        {saving ? (
          <Tag color="processing">保存中</Tag>
        ) : dirty ? (
          <Tag color="warning">待保存</Tag>
        ) : (
          <Tag color="success">{savedAt ? `已保存 ${savedAt}` : '已保存'}</Tag>
        )}
        <IssueIndicator issues={issues} />
      </Space>

      {/* 编辑操作 + 视图 */}
      <Space size={4} split={<Divider type="vertical" style={{ margin: 0 }} />}>
        <Space size={0}>
          <Tooltip title="撤销">
            <Button
              type="text"
              size="small"
              icon={<UndoOutlined />}
              disabled={past.length === 0}
              onClick={undo}
            />
          </Tooltip>
          <Tooltip title="重做">
            <Button
              type="text"
              size="small"
              icon={<RedoOutlined />}
              disabled={future.length === 0}
              onClick={redo}
            />
          </Tooltip>
          <Tooltip title={canDelete ? '删除选中组件' : '未选中组件'}>
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canDelete}
              onClick={() => selectedId && removeNode(selectedId)}
            />
          </Tooltip>
        </Space>

        <Tooltip title="快捷键：⌘Z 撤销 / ⇧⌘Z 重做 / Delete 删除">
          <Button type="text" size="small" icon={<ThunderboltOutlined />}>
            热键
          </Button>
        </Tooltip>

        <Space size={6}>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>投放</span>
          <Segmented
            size="small"
            value={device}
            onChange={(value) => onDeviceChange(value as DeviceMode)}
            options={[
              { value: 'desktop', icon: <DesktopOutlined /> },
              { value: 'mobile', icon: <MobileOutlined /> },
            ]}
          />
        </Space>

        <Button type="text" size="small" icon={<NodeIndexOutlined />} onClick={onOpenEvents}>
          活动编排
        </Button>

        <Button type="text" size="small" icon={<EyeOutlined />} onClick={onPreview}>
          预览
        </Button>

        <Tooltip title="以当前草稿为蓝本创建模板">
          <Button type="text" size="small" icon={<SnippetsOutlined />} onClick={onSaveAsTemplate}>
            存为模板
          </Button>
        </Tooltip>
      </Space>

      {/* 交付 */}
      <Space size={4} style={{ minWidth: 240, justifyContent: 'flex-end' }}>
        <Button size="small" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
          保存
        </Button>
        <Upload accept="application/json" showUploadList={false} beforeUpload={importDsl}>
          <Button size="small" icon={<ImportOutlined />}>
            导入 DSL
          </Button>
        </Upload>
        <Tooltip title="以 C 端身份打开活动页，验证登录态相关逻辑">
          <Button size="small" icon={<LoginOutlined />} onClick={onPreview}>
            C 端登录
          </Button>
        </Tooltip>
        <Button type="primary" size="small" icon={<CloudUploadOutlined />} onClick={onPublish}>
          发布
        </Button>
      </Space>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Layout, Modal, Spin, Tabs, message } from 'antd';
import { ApartmentOutlined, AppstoreOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { validateFinalDsl } from '@nca/dsl';
import { describeUpgrade, materialVersions, upgradeMaterials } from '@nca/materials';
import { activityApi, materialApi } from '../api';
import { useDesignerStore } from '../stores/designer';
import { MaterialPanel } from '../components/designer/MaterialPanel';
import { SettingPanel } from '../components/designer/SettingPanel';
import { IframeCanvasSurface } from '../components/designer/IframeCanvasSurface';
import { NodeTree } from '../components/designer/NodeTree';
import { DataSourcePanel } from '../components/designer/DataSourcePanel';
import { formatIssues } from '../components/designer/IssuePanel';
import { DesignerHeader, type DeviceMode } from '../components/designer/DesignerHeader';
import { SaveAsTemplateModal } from '../components/designer/SaveAsTemplateModal';
import { AiPanel } from '../components/designer/AiPanel';
import { PageSettingsModal } from '../components/designer/PageSettingsModal';

const AUTOSAVE_DELAY = 1500;

/** 投放机型 → 画布尺寸。桌面按 750 设计稿等宽预览，移动按主流机型宽度 */
const DEVICE_SIZE: Record<DeviceMode, { width: number; height: number }> = {
  desktop: { width: 480, height: 800 },
  mobile: { width: 375, height: 667 },
};

const RENDERER_ORIGIN = import.meta.env.VITE_RENDERER_ORIGIN ?? 'http://localhost:5180';

export function DesignerPage() {
  const { activityId } = useParams({ from: '/designer/$activityId' });
  const navigate = useNavigate();
  const { dsl, dirty, load, select, markSaved } = useDesignerStore();
  const [savedAt, setSavedAt] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const [changelog, setChangelog] = useState('');
  const [device, setDevice] = useState<DeviceMode>('mobile');
  const [leftTab, setLeftTab] = useState('materials');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [rightTabKey, setRightTabKey] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);

  const { data: metas = [], isLoading: metaLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: materialApi.list,
  });

  const { data: draft, isLoading: draftLoading } = useQuery({
    queryKey: ['draft', activityId],
    queryFn: () => activityApi.getDraft(activityId),
  });

  // 打开草稿时把旧版物料的节点升到当前版本：先原样载入，有改动再作为一步可撤销的
  // 编辑应用上去——会触发自动保存，下次打开就不用再升了
  useEffect(() => {
    if (!draft) return;
    load(draft);
    const upgraded = upgradeMaterials(draft, materialVersions);
    if (upgraded.changed) useDesignerStore.getState().applyDsl(upgraded.dsl);
    const { migrated, blocked, newer } = upgraded.report;
    if (migrated.length > 0) {
      void message.info(`${migrated.length} 个组件已升级到新版物料，可撤销`);
    }
    if (blocked.length > 0 || newer.length > 0) {
      Modal.warning({
        title: '部分组件的物料版本需要处理',
        content: (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {describeUpgrade({ ...upgraded.report, migrated: [] }).map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        ),
      });
    }
  }, [draft, load]);

  const saveMutation = useMutation({
    mutationFn: () => activityApi.saveDraft(activityId, dsl),
    onSuccess: (result) => {
      markSaved();
      setSavedAt(new Date(result.updatedAt).toLocaleTimeString('zh-CN'));
      // warning 不再逐条弹窗：编辑中「还没填完」是常态，
      // 每敲一次键弹一串提示只会把人淹没。顶栏的待完善标签常驻汇总即可。
    },
    onError: (err: Error) => void message.error(`保存失败：${err.message}`),
  });

  // 自动保存：编辑停顿后再提交，避免每次改动都打一次接口
  const timerRef = useRef<number>();
  const saveRef = useRef(saveMutation.mutate);
  saveRef.current = saveMutation.mutate;

  useEffect(() => {
    if (!dirty) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => saveRef.current(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timerRef.current);
  }, [dirty, dsl]);

  // 拖拽在任何位置释放都要收尾：松手在画布外也得清掉落点提示与拖拽态
  useEffect(() => {
    const onUp = () => useDesignerStore.getState().endDrag();
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  // 离开前拦一道，未保存的编辑不该悄悄丢掉
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // 键盘快捷键：与顶栏「热键」提示保持一致
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 正在输入框里打字时不该抢键
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const store = useDesignerStore.getState();

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId) {
        e.preventDefault();
        store.removeNode(store.selectedId);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const publishMutation = useMutation({
    mutationFn: async () => {
      // 发布前先把当前编辑落库，否则发的是上一次自动保存的内容
      await activityApi.saveDraft(activityId, dsl);
      return activityApi.publish(activityId, changelog || undefined);
    },
    onSuccess: (result) => {
      markSaved();
      setPublishing(false);
      setChangelog('');
      Modal.success({
        title: `发布成功 v${result.version}`,
        content: (
          <div>
            <p>活动地址：</p>
            <a href={result.activityUrl} target="_blank" rel="noreferrer">
              {result.activityUrl}
            </a>
          </div>
        ),
      });
    },
    onError: (err: Error & { errors?: { level: string; message: string; location?: string }[] }) => {
      const detail = err.errors?.filter((e) => e.level === 'error') ?? [];
      if (detail.length > 0) {
        Modal.error({
          title: '发布未通过校验',
          content: (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {detail.map((e, i) => (
                <li key={i}>{e.location ? `${e.location}：${e.message}` : e.message}</li>
              ))}
            </ul>
          ),
        });
        return;
      }
      void message.error(`发布失败：${err.message}`);
    },
  });

  const handleSelectFromCanvas = useCallback(
    (nodeId: string) => {
      select(nodeId);
      // 从画布选中时把右栏切回属性页，省得运营再点一次
      setRightTabKey((k) => k + 1);
    },
    [select],
  );

  /**
   * 本地跑一遍发布级校验，把「发布前必须补齐」的项即时呈现在顶栏。
   * 与后端调用的是 @nca/dsl 里同一个 validateFinalDsl，规则不可能不一致。
   */
  const blockingIssues = useMemo(() => {
    const result = validateFinalDsl(dsl, { mode: 'publish' });
    return result.issues.filter((i) => i.level === 'error');
  }, [dsl]);

  const handlePublish = () => {
    if (blockingIssues.length > 0) {
      Modal.warning({
        title: `还有 ${blockingIssues.length} 处配置待补齐`,
        content: (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {formatIssues(blockingIssues).map((text, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {text}
              </li>
            ))}
          </ul>
        ),
      });
      return;
    }
    setPublishing(true);
  };

  if (metaLoading || draftLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const size = DEVICE_SIZE[device];

  return (
    <Layout style={{ height: '100vh' }}>
      <DesignerHeader
        title={dsl.meta.title}
        dirty={dirty}
        savedAt={savedAt}
        saving={saveMutation.isPending}
        issues={blockingIssues}
        device={device}
        onDeviceChange={setDevice}
        onBack={() => void navigate({ to: '/activities' })}
        onSave={() => saveMutation.mutate()}
        onPublish={handlePublish}
        onPreview={() => window.open(`${RENDERER_ORIGIN}/?id=${activityId}`, '_blank')}
        onOpenEvents={() => setLeftTab('data')}
        onOpenPageSettings={() => setPageSettingsOpen(true)}
        onSaveAsTemplate={() => {
          // 模板取的是服务端草稿，先把当前编辑落库，否则存进去的是上一次自动保存的内容
          saveMutation.mutate(undefined, { onSuccess: () => setSavingTemplate(true) });
        }}
        aiOpen={aiOpen}
        onToggleAi={() => {
          // AI 读的是服务端草稿，先把当前编辑落库，否则它看到的是上一次自动保存的页面
          if (!aiOpen && dirty) saveMutation.mutate();
          setAiOpen((prev) => !prev);
        }}
      />

      <Layout>
        <Layout.Sider width={272} theme="light" style={{ overflow: 'auto', borderRight: '1px solid #f0f0f0' }}>
          <Tabs
            size="small"
            centered
            activeKey={leftTab}
            onChange={setLeftTab}
            style={{ padding: '0 4px' }}
            items={[
              {
                key: 'materials',
                label: (
                  <span>
                    <AppstoreOutlined /> 组件库
                  </span>
                ),
                children: <MaterialPanel metas={metas} />,
              },
              {
                key: 'tree',
                label: (
                  <span>
                    <ApartmentOutlined /> 结构
                  </span>
                ),
                children: (
                  <div style={{ padding: 8 }}>
                    <NodeTree />
                  </div>
                ),
              },
              {
                key: 'data',
                label: (
                  <span>
                    <DatabaseOutlined /> 数据
                    {dsl.dataSources.length > 0 ? ` (${dsl.dataSources.length})` : ''}
                  </span>
                ),
                children: <DataSourcePanel />,
              },
            ]}
          />
        </Layout.Sider>

        <Layout.Content>
          <IframeCanvasSurface
            dsl={dsl}
            onSelectNode={handleSelectFromCanvas}
            designWidth={size.width}
            canvasHeight={size.height}
          />
        </Layout.Content>

        <Layout.Sider
          width={320}
          theme="light"
          style={{ overflow: 'auto', borderLeft: '1px solid #f0f0f0' }}
        >
          <SettingPanel key={rightTabKey} metas={metas} />
        </Layout.Sider>

        {aiOpen && (
          <Layout.Sider
            width={380}
            theme="light"
            style={{ overflow: 'auto', borderLeft: '1px solid #f0f0f0' }}
          >
            <AiPanel activityId={activityId} metas={metas} />
          </Layout.Sider>
        )}
      </Layout>

      <PageSettingsModal open={pageSettingsOpen} onClose={() => setPageSettingsOpen(false)} />

      <SaveAsTemplateModal
        open={savingTemplate}
        activityId={activityId}
        defaultTitle={dsl.meta.title}
        onClose={() => setSavingTemplate(false)}
      />

      <Modal
        title="发布活动"
        open={publishing}
        onCancel={() => setPublishing(false)}
        onOk={() => publishMutation.mutate()}
        confirmLoading={publishMutation.isPending}
        okText="确认发布"
      >
        <p style={{ color: '#888' }}>发布会生成一个不可变的版本快照，可随时回滚。</p>
        <Input.TextArea
          rows={3}
          placeholder="本次发布说明（选填）"
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
        />
      </Modal>
    </Layout>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Layout, Space, Spin, Tabs, Tag, Tooltip, message, Modal, Input } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { activityApi, materialApi } from '../api';
import { useDesignerStore } from '../stores/designer';
import { MaterialPanel } from '../components/designer/MaterialPanel';
import { SettingPanel } from '../components/designer/SettingPanel';
import { IframeCanvasSurface } from '../components/designer/IframeCanvasSurface';
import { NodeTree } from '../components/designer/NodeTree';
import { DataSourcePanel } from '../components/designer/DataSourcePanel';

const AUTOSAVE_DELAY = 1500;

export function DesignerPage() {
  const { activityId } = useParams({ from: '/designer/$activityId' });
  const navigate = useNavigate();
  const { dsl, dirty, load, select, markSaved, undo, redo, past, future } = useDesignerStore();
  const [savedAt, setSavedAt] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const [changelog, setChangelog] = useState('');

  const { data: metas = [], isLoading: metaLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: materialApi.list,
  });

  const { data: draft, isLoading: draftLoading } = useQuery({
    queryKey: ['draft', activityId],
    queryFn: () => activityApi.getDraft(activityId),
  });

  useEffect(() => {
    if (draft) load(draft);
  }, [draft, load]);

  const saveMutation = useMutation({
    mutationFn: () => activityApi.saveDraft(activityId, dsl),
    onSuccess: (result) => {
      markSaved();
      setSavedAt(new Date(result.updatedAt).toLocaleTimeString('zh-CN'));
      result.issues
        .filter((i) => i.level === 'warning')
        .forEach((i) => void message.warning(`${i.path}: ${i.message}`));
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
    onError: (err: Error) => void message.error(`发布失败：${err.message}`),
  });

  const handleSelectFromCanvas = useCallback((nodeId: string) => select(nodeId), [select]);

  if (metaLoading || draftLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载设计器" />
      </div>
    );
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
          paddingInline: 16,
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Space>
          <Button size="small" onClick={() => void navigate({ to: '/activities' })}>
            返回
          </Button>
          <strong>{dsl.meta.title}</strong>
          {dirty ? (
            <Tag color="warning">未保存</Tag>
          ) : (
            <Tag color="success">{savedAt ? `已保存 ${savedAt}` : '已保存'}</Tag>
          )}
        </Space>
        <Space>
          <Tooltip title="撤销">
            <Button size="small" disabled={past.length === 0} onClick={undo}>
              撤销
            </Button>
          </Tooltip>
          <Tooltip title="重做">
            <Button size="small" disabled={future.length === 0} onClick={redo}>
              重做
            </Button>
          </Tooltip>
          <Button size="small" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            保存
          </Button>
          <Button type="primary" size="small" onClick={() => setPublishing(true)}>
            发布
          </Button>
        </Space>
      </Layout.Header>

      <Layout>
        <Layout.Sider width={280} theme="light" style={{ overflow: 'auto' }}>
          <Tabs
            size="small"
            centered
            style={{ padding: '0 8px' }}
            items={[
              {
                key: 'materials',
                label: '组件',
                children: (
                  <>
                    <MaterialPanel metas={metas} />
                    <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                      <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>节点树</div>
                      <NodeTree />
                    </div>
                  </>
                ),
              },
              {
                key: 'data',
                label: `数据源${dsl.dataSources.length > 0 ? ` (${dsl.dataSources.length})` : ''}`,
                children: <DataSourcePanel />,
              },
            ]}
          />
        </Layout.Sider>

        <Layout.Content>
          <IframeCanvasSurface
            dsl={dsl}
            onSelectNode={handleSelectFromCanvas}
            designWidth={375}
          />
        </Layout.Content>

        <Layout.Sider width={300} theme="light" style={{ overflow: 'auto', padding: 8 }}>
          <SettingPanel metas={metas} />
        </Layout.Sider>
      </Layout>

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

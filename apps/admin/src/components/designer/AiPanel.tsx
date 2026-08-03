import { useRef, useState } from 'react';
import { Alert, Button, Input, Space, Tag, Typography, message } from 'antd';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { validateFinalDsl, type FinalDsl, type MaterialMeta } from '@nca/dsl';
import type { AiEvent, AiPatchPreview } from '@nca/shared';
import { streamEdit } from '../../api/ai';
import { useDesignerStore } from '../../stores/designer';

interface Props {
  activityId: string;
  metas: MaterialMeta[];
}

interface Draft {
  summary: string;
  patches: AiPatchPreview[];
  issues: string[];
  dsl: FinalDsl;
}

/**
 * 设计器里的 AI 助手：自然语言说要改什么，看清 diff 再决定应不应用。
 *
 * 和工作台的分工是：工作台负责「从零把一个活动搭起来」那条流程，这里负责
 * 「已经搭好了，现在想改一处」。后者没有流程可言，所以不走工作流与中断点，
 * 就是一问一答——但产物同样是补丁，同样要人点头才落到画布上。
 */
export function AiPanel({ activityId, metas }: Props) {
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const selectedId = useDesignerStore((s) => s.selectedId);
  const selectedType = useDesignerStore((s) =>
    s.selectedId ? s.dsl.craftJson[s.selectedId]?.type.resolvedName : undefined,
  );

  const run = async () => {
    if (!instruction.trim() || running) return;
    setRunning(true);
    setError('');
    setDraft(null);
    setThinking('');

    const controller = new AbortController();
    abortRef.current = controller;

    let summary = '';
    let patches: AiPatchPreview[] = [];
    let issues: string[] = [];

    try {
      await streamEdit(
        {
          activityId,
          instruction,
          ...(selectedId ? { selectedNodeId: selectedId } : {}),
        },
        (event: AiEvent) => {
          switch (event.type) {
            case 'thinking':
              setThinking((prev) => (prev + event.delta).slice(-600));
              break;
            case 'patch':
              summary = event.summary;
              patches = event.patches;
              issues = event.issues;
              break;
            case 'dsl':
              setDraft({ summary, patches, issues, dsl: event.dsl as FinalDsl });
              break;
            case 'error':
              setError(event.message);
              break;
            default:
              break;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : '生成失败');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const apply = () => {
    if (!draft) return;
    // 落画布前再校验一次：服务端已经校过，但产物经过一次网络传输，
    // 而一份坏 DSL 会让整个画布白屏，这道保险不贵
    const result = validateFinalDsl(draft.dsl, {
      mode: 'draft',
      knownMaterials: metas.map((m) => m.name),
    });
    if (!result.success) {
      void message.error(`产物不合法：${result.issues[0]?.message ?? '未知错误'}`);
      return;
    }
    // 必须走 applyDsl 而不是 load：后者会清空撤销栈并把 dirty 置 false，
    // 结果是这次生成既撤销不了、也不会自动保存
    useDesignerStore.getState().applyDsl(result.data as FinalDsl);
    setDraft(null);
    setInstruction('');
    void message.success('已应用，可 ⌘Z 撤销');
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alert
        type="info"
        showIcon
        icon={<RobotOutlined />}
        style={{ fontSize: 12 }}
        message="说清楚要改什么，AI 会先给出改动清单，确认后才落到画布上。"
      />

      <div>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>
          {selectedId ? (
            <>
              改动将聚焦在选中的 <Tag color="blue">{selectedType ?? selectedId}</Tag>
            </>
          ) : (
            '当前没有选中组件，AI 会按整页理解'
          )}
        </div>
        {/* 必须用 TextArea：设计器全局监听 keydown，非输入框焦点下 Delete 会删节点 */}
        <Input.TextArea
          rows={3}
          value={instruction}
          disabled={running}
          placeholder="例如：把抽奖按钮改成橙色，并在中奖后弹一个恭喜弹窗"
          onChange={(e) => setInstruction(e.target.value)}
        />
        <Space style={{ marginTop: 8 }}>
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            loading={running}
            disabled={!instruction.trim()}
            onClick={() => void run()}
          >
            {running ? '生成中' : '生成改动'}
          </Button>
          {running && (
            <Button size="small" onClick={() => abortRef.current?.abort()}>
              停止
            </Button>
          )}
        </Space>
      </div>

      {running && thinking && (
        <div
          style={{
            fontSize: 12,
            color: '#bfbfbf',
            background: '#fafafa',
            borderRadius: 6,
            padding: 8,
            maxHeight: 120,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {thinking}
        </div>
      )}

      {error && <Alert type="error" showIcon message={error} style={{ fontSize: 12 }} />}

      {draft && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {draft.summary || '改动清单'}
          </Typography.Text>

          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#595959' }}>
            {draft.patches.map((p, i) => (
              <li key={i}>{p.text}</li>
            ))}
          </ul>

          {draft.issues.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8, fontSize: 12 }}
              message={`有 ${draft.issues.length} 处没能生效`}
              description={
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {draft.issues.slice(0, 5).map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              }
            />
          )}

          <Space style={{ marginTop: 12 }}>
            <Button type="primary" size="small" onClick={apply}>
              应用到画布
            </Button>
            <Button size="small" onClick={() => setDraft(null)}>
              放弃
            </Button>
          </Space>
        </div>
      )}
    </div>
  );
}

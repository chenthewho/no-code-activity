import { useCallback, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Space, Spin, Typography } from 'antd';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate } from '@tanstack/react-router';
import type { FinalDsl } from '@nca/dsl';
import type { AiEvent, AiInterrupt, AiResume } from '@nca/shared';
import { aiApi, streamRun } from '../api/ai';
import { InterruptCard } from '../components/ai/InterruptCard';
import { PreviewFrame } from '../components/designer/PreviewFrame';

interface LogItem {
  id: number;
  kind: 'user' | 'status' | 'text';
  text: string;
}

/**
 * AI 工作台：从一句话到一个能发布的活动。
 *
 * 左边是对话与中断卡片，右边是实时预览——运营在每张卡片上做决定的同时，
 * 右侧就是线上会长的样子。这比先搭完再一次性给人看要可信得多。
 */
export function AiWorkbenchPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [card, setCard] = useState<AiInterrupt | null>(null);
  const [dsl, setDsl] = useState<FinalDsl | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const append = useCallback((kind: LogItem['kind'], text: string) => {
    setLog((prev) => {
      const next = [...prev];
      const tail = next[next.length - 1];
      // 文本增量并到同一条，不然一个 token 一行
      if (kind === 'text' && tail?.kind === 'text') {
        next[next.length - 1] = { ...tail, text: tail.text + text };
        return next;
      }
      seq.current += 1;
      return [...next, { id: seq.current, kind, text }];
    });
  }, []);

  const consume = useCallback(
    (event: AiEvent) => {
      switch (event.type) {
        case 'status':
          append('status', event.status);
          break;
        case 'text':
          append('text', event.delta);
          break;
        case 'interrupt':
          setCard(event.interrupt);
          break;
        case 'dsl': {
          const next = event.dsl as FinalDsl;
          setDsl(next);
          setActivityId(next.meta.activityId);
          break;
        }
        case 'done':
          setDone(true);
          setCard(null);
          break;
        case 'error':
          setError(event.message);
          setCard(null);
          break;
        default:
          break;
      }
    },
    [append],
  );

  const drive = useCallback(
    async (id: string, resume?: AiResume) => {
      setBusy(true);
      setCard(null);
      setError('');
      try {
        await streamRun(id, resume, consume);
      } catch (err) {
        setError(err instanceof Error ? err.message : '生成失败');
      } finally {
        setBusy(false);
      }
    },
    [consume],
  );

  const start = async () => {
    if (!prompt.trim() || busy) return;
    append('user', prompt);
    try {
      const run = await aiApi.start({ prompt });
      setRunId(run.id);
      await drive(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const submit = (resume: AiResume) => {
    if (!runId) return;
    void drive(runId, resume);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 112px)' }}>
      {/* 左：对话与卡片 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          <RobotOutlined /> AI 工作台
        </Typography.Title>

        <div style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
          {log.length === 0 && !runId && (
            <Alert
              type="info"
              showIcon
              style={{ fontSize: 12 }}
              message="描述你想做的活动，AI 会一步步带你搭出来"
              description="每一步都会停下来让你确认，发布前还要再点一次头。"
            />
          )}

          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {log.map((item) => (
              <div
                key={item.id}
                style={{
                  fontSize: item.kind === 'user' ? 14 : 12,
                  color:
                    item.kind === 'user'
                      ? '#262626'
                      : item.kind === 'status'
                        ? '#1677ff'
                        : '#595959',
                  background: item.kind === 'user' ? '#f5f5f5' : 'transparent',
                  borderRadius: 6,
                  padding: item.kind === 'user' ? '8px 12px' : 0,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {item.kind === 'status' ? `· ${item.text}` : item.text}
              </div>
            ))}

            {busy && !card && (
              <Space style={{ fontSize: 12, color: '#8c8c8c' }}>
                <Spin size="small" /> 处理中…
              </Space>
            )}

            {card && <InterruptCard card={card} busy={busy} onSubmit={submit} />}

            {error && <Alert type="error" showIcon message={error} />}

            {done && (
              <Alert
                type="success"
                showIcon
                message="这一轮走完了"
                description={
                  activityId ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0 }}
                      onClick={() => void navigate({ to: `/designer/${activityId}` })}
                    >
                      去设计器里继续精修 →
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Space>
        </div>

        {!runId && (
          <div style={{ marginTop: 12 }}>
            <Input.TextArea
              rows={3}
              value={prompt}
              disabled={busy}
              placeholder="例如：做一个夏日抽奖活动，7 月 1 日到 7 月 31 日，九宫格抽奖，中奖后弹窗提示"
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              style={{ marginTop: 8 }}
              loading={busy}
              disabled={!prompt.trim()}
              onClick={() => void start()}
            >
              开始搭建
            </Button>
          </div>
        )}
      </div>

      {/* 右：实时预览 */}
      <div
        style={{
          width: 400,
          borderLeft: '1px solid #f0f0f0',
          paddingLeft: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>实时预览</div>
        {dsl ? (
          <PreviewFrame dsl={dsl} width={375} height={667} />
        ) : (
          <Empty
            style={{ marginTop: 80 }}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="页面搭出来后会显示在这里"
          />
        )}
      </div>
    </div>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportMonitor } from '../runtime/monitor';

interface Props {
  nodeId: string;
  material: string;
  editing: boolean;
  /** 节点数据变了就重试渲染：设计器里改对了属性，红框应当随之消失 */
  resetKey: unknown;
  children: ReactNode;
}

/**
 * 节点级错误边界：一个物料渲染抛错只坏掉它自己，整页不白屏。
 * 线上静默隐藏该节点并上报；编辑态画出红框，让运营一眼看到哪个组件坏了。
 */
export class NodeErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[nca] 组件 ${this.props.nodeId}（${this.props.material}）渲染失败`, error);
    if (!this.props.editing) {
      reportMonitor('js_error', {
        message: error.message,
        detail: {
          nodeId: this.props.nodeId,
          material: this.props.material,
          stack: info.componentStack?.slice(0, 1000),
        },
      });
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return this.props.editing ? (
      <div style={{ padding: 12, color: '#d4380d', border: '1px dashed #d4380d', fontSize: 12 }}>
        组件「{this.props.material}」渲染失败：{this.state.error.message}
      </div>
    ) : null;
  }
}

import { useRuntime } from '../runtime/RuntimeProvider';

const COLORS: Record<string, string> = {
  info: 'rgba(0,0,0,.75)',
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
};

/** 全局轻提示层，toast 动作的落点 */
export function ToastLayer() {
  const { toasts } = useRuntime();
  if (toasts.length === 0) return null;

  return (
    <div className="nca-toast-layer">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="nca-toast"
          style={{ backgroundColor: COLORS[toast.level] ?? COLORS.info }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

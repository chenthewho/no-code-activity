/**
 * 首屏骨架屏：用占位块模拟活动页常见版式（头图/标题/段落/九宫格/按钮），
 * 在 manifest + DSL 拉取期间展示，避免白屏等待。样式见 styles.css 的 nca-skel。
 */
export function BootSkeleton() {
  return (
    <div className="nca-skeleton" aria-busy="true" aria-label="页面加载中">
      <div className="nca-skel nca-skel--banner" />
      <div className="nca-skel nca-skel--title" />
      <div className="nca-skel nca-skel--line" />
      <div className="nca-skel nca-skel--line" style={{ width: '72%' }} />
      <div className="nca-skel nca-skel--grid">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="nca-skel nca-skel--cell" />
        ))}
      </div>
      <div className="nca-skel nca-skel--btn" />
    </div>
  );
}

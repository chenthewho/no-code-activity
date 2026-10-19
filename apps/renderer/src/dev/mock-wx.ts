/**
 * 开发期的小程序 web-view 模拟：?mock_wx=1 时装一个假的 wx.miniProgram，
 * 把调用转发给父页面（宿主模拟器 host-sim.html）。只在 DEV 构建里被调用，
 * 生产包里整段被摇树摇掉。
 */
export function installMockMiniProgram(): void {
  if (new URLSearchParams(window.location.search).get('mock_wx') !== '1') return;
  window.__wxjs_environment = 'miniprogram';
  const forward = (kind: string, payload: Record<string, unknown>) =>
    window.parent.postMessage({ source: 'nca-host-sim', kind, ...payload }, '*');
  window.wx = {
    miniProgram: {
      navigateTo: ({ url }) => forward('wx.navigateTo', { url }),
      postMessage: ({ data }) => forward('wx.postMessage', { data }),
    },
  };
}

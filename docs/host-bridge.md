# 宿主接入文档

> 面向接入方：SDK / 游戏中心 / LDQ 客户端 / 微信小程序的开发同学。
> 同一份活动页（H5）跑在所有宿主里，差异全部收敛在渲染器的宿主适配层。
> 宿主要做的只有两件事：**告诉页面「我是谁」**，以及**提供登录、分享等能力的桥接**。

## 1. 宿主识别

渲染器启动时按以下优先级判定宿主：

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1 | `window.__NCA_HOST__`（宿主容器注入） | 原生 WebView 容器 |
| 2 | 地址参数 `?host=xxx` | iframe 宿主、设计器预览、联调 |
| 3 | `window.__wxjs_environment === 'miniprogram'`（微信设置） | 小程序 web-view |
| 4 | 都没有 | 浏览器 |

取值：`browser` / `game_center` / `ldq_pc` / `ldq_app` / `sdk_portrait` / `sdk_landscape` / `wechat_mini_program`。

不做 UA 嗅探——微信 H5 与小程序 web-view 的 UA 完全一样，靠它分不出来。

宿主判定会影响：

- 表达式里的 `{{ host }}`，运营可据此做差异化展示（如 `{{ host === 'sdk_portrait' }}`）
- 只在部分宿主可用的组件（物料 `supportedHosts`）在其它宿主里不渲染
- 登录、分享、跳转、下载等动作的具体实现

## 2. 原生容器：注入式桥接

适用：SDK 竖屏/横屏、LDQ App、游戏中心 App 内嵌页。

**必须在页面脚本执行前注入**（iOS `WKUserScript` 用 `atDocumentStart`；Android 在
`onPageStarted` 里 `evaluateJavascript`），否则渲染器启动时读不到，会按浏览器处理。

```js
window.__NCA_HOST__ = 'sdk_portrait';
window.__NCA_BRIDGE__ = {
  // 拉起宿主登录。成功后返回一次性 code（推荐），由活动页拿去服务端换身份
  login: () => nativeCall('login'), // → Promise<{ code: string } | null>
  logout: () => nativeCall('logout'), // → Promise<void>
  share: (payload) => nativeCall('share', payload), // payload: { title, desc, cover, channel }
  navigate: (url, target) => nativeCall('navigate', { url, target }),
  downloadGame: (gameId) => nativeCall('downloadGame', { gameId }),
  // 宿主私有能力，method 白名单由宿主自己裁决，不支持的直接 reject
  invoke: (method, params) => nativeCall('invoke', { method, params }),
};
```

任何方法都可以缺省，缺省时渲染器回落到浏览器行为（分享走系统分享、跳转走 `location`）。

### login 的返回值

| 返回 | 含义 | 推荐 |
|---|---|---|
| `{ code }` | 宿主账号服务签发的一次性 code，页面调 `POST /runtime/auth/host-login` 换 C 端 token | ✅ |
| `{ ticket }` | 已经在外层换好的平台票据，页面调 `POST /runtime/auth/exchange` 换 token | ✅ |
| `{ userId }` | 旧协议：直接报用户 id | ⚠️ 页面脚本可伪造，只当访客标识，不算登录 |
| `null` | 用户取消或宿主不支持 | |

### 服务端校验宿主 code

`HOST_AUTH_MODE=http` 时，服务端把 code 转给宿主账号服务校验：

```
POST ${HOST_AUTH_VERIFY_URL}
Content-Type: application/json

{ "host": "sdk_portrait", "code": "<宿主给的 code>" }
```

成功返回 `200 { "userId": "...", "nickname": "...", "avatar": "..." }`（后两项可选），
其余一律视为校验失败。同一宿主同一 `userId` 在平台上是同一个 C 端用户；
不同宿主的 id 不在一个命名空间里，不会合并。

本地联调用 `HOST_AUTH_MODE=mock`：接受形如 `mock:<userId>[:<昵称>]` 的 code，生产环境禁用。

## 3. iframe 宿主：postMessage 桥

适用：PC 游戏中心、LDQ PC 端等把活动页嵌在 `<iframe>` 里、没法往页面注入对象的宿主。

活动页地址带上 `?host=<宿主>&bridge=postmessage`（显式开启，否则任何被嵌进 iframe 的
页面都会对着不回话的父页面空等）。协议：

```
页面 → 宿主  { source: 'nca-bridge', id, method, params }
宿主 → 页面  { source: 'nca-bridge', id, result }  或  { source: 'nca-bridge', id, error }
```

`method` 与上节的桥接方法一一对应。页面只认来自 `window.parent` 的回复；
login 等 120 秒，其余 10 秒无回复视为失败。宿主侧示例：

```js
window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (msg?.source !== 'nca-bridge' || event.source !== activityFrame.contentWindow) return;
  try {
    const result = await handlers[msg.method](msg.params); // login → { code }
    event.source.postMessage({ source: 'nca-bridge', id: msg.id, result }, event.origin);
  } catch (err) {
    event.source.postMessage({ source: 'nca-bridge', id: msg.id, error: String(err) }, event.origin);
  }
});
```

## 4. 微信小程序：web-view

不做小程序原生渲染器，活动页跑在 `<web-view>` 里，通过 JSSDK 的 `wx.miniProgram` 通信
（渲染器按需加载 jweixin，首屏不受影响）。活动域名需在小程序后台配置为**业务域名**。

### 登录

1. 活动页需要登录时 `wx.miniProgram.navigateTo('/pages/nca-login/index?redirect=<当前地址>')`
   （登录页路径可用活动地址参数 `?mp_login=/pages/xxx` 覆盖）
2. 登录页 `wx.login` 拿 code，调服务端换票据，再带票据重开 web-view：

```js
// pages/nca-login/index.js
Page({
  async onLoad({ redirect }) {
    const { code } = await wx.login();
    const { data } = await wx.request({
      url: 'https://api.example.com/api/v1/runtime/auth/wechat-mp',
      method: 'POST',
      data: { code },
    }); // → { ticket, expiresIn: 60 }
    const target = decodeURIComponent(redirect);
    const join = target.includes('?') ? '&' : '?';
    wx.redirectTo({
      url: `/pages/activity/index?src=${encodeURIComponent(`${target}${join}nca_ticket=${data.ticket}`)}`,
    });
  },
});
```

3. web-view 打开带 `nca_ticket` 的地址，渲染器启动时换成 token，并立刻从地址栏抹掉票据。

服务端配 `WECHAT_MP_APPID` / `WECHAT_MP_SECRET` 后走 `code2Session`，有 `unionid` 优先用
`unionid`。返回的是 60 秒有效的一次性票据而不是 token：票据进了 URL 也很快作废。

### 分享

web-view 页面不能直接调起分享。活动页的「分享」动作会 `postMessage` 一条
`{ type: 'nca:share', title, desc, cover, link }` 并提示用户点右上角。小程序在
`onShareAppMessage` 里取最后一条：

```js
// pages/activity/index.js
Page({
  share: null,
  onMessage(e) {
    const last = e.detail.data.filter((d) => d.type === 'nca:share').pop();
    if (last) this.share = last;
  },
  onShareAppMessage() {
    const s = this.share ?? {};
    return { title: s.title, imageUrl: s.cover, path: `/pages/activity/index?src=${encodeURIComponent(s.link ?? '')}` };
  },
});
```

### 其它

- 跳转：`mp:` 开头的地址走小程序路由（`mp:/pages/xxx`），其余在 web-view 内打开
- 下载游戏：小程序内不支持，活动页会提示用户去应用商店
- `sdk.invoke` / 登出：以 `{ type: 'nca:invoke' | 'nca:logout', ... }` postMessage 给小程序，单向、无返回值

## 5. 横屏与布局

- 竖屏：按视口宽等比缩放（750 设计稿在 375 宽屏上 1 设计像素 = 0.5px）
- **横屏里放竖版稿**（SDK 横屏、PC 浏览器、平板横置）：收成一列 9:16 的手机宽居中显示，
  列宽不小于 375——照旧按宽缩放的话，750 的稿子会被放大到横屏全宽，首屏只剩个头图
- 横屏专属页面请按 1334 宽出稿（页面设置里改设计稿宽度），渲染器按宽度正常缩放
- PC 固定宽页面用「不缩放」模式

## 6. 投放宿主与宿主专属组件

- 页面设置里勾选**投放宿主**；渲染器在未勾选的宿主里照常渲染，但会打一条警告
- 物料可以声明 `supportedHosts`，在其它宿主里不渲染；投放宿主里有它不支持的，
  设计器发布前会提示「该组件在 xx 中不会显示」

## 7. 联调：宿主模拟器

开发环境打开 `http://localhost:5180/host-sim.html?id=<活动id>`：同一个活动并排跑在
浏览器、SDK 竖屏、SDK 横屏、游戏中心、小程序五个宿主里，模拟器扮演宿主一方——
回应 postMessage 桥的调用、扮演小程序登录页换票据，右侧日志能看到每一次桥接往来。
需要服务端 `HOST_AUTH_MODE=mock`。

设计器顶栏的宿主下拉框可以直接以某个宿主的身份预览画布（SDK 横屏会切成横向画布）。

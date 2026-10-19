import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

/**
 * 首屏关键路径提速：DSL 不必等 JS 下载、解析、React 挂载完才开始拉。
 * index.html 头部内联一小段脚本，页面一开始解析就发出 DSL 请求，与 JS 下载并行；
 * loader 拿到同一个地址时直接复用这次请求（见 bootstrap/loader.ts 的 takePrefetch）。
 * 顺带 preconnect API 域名，省掉一次 DNS + TLS。只作用于活动页 index.html。
 */
function dslPrefetch(apiBase: string): Plugin {
  const script = `(function(){try{var q=new URLSearchParams(location.search);if(q.get('preview'))return;var id=q.get('id')||location.pathname.split('/act/')[1];var dsl=q.get('dsl');if(!id&&!dsl)return;var url=dsl||${JSON.stringify(apiBase)}+'/runtime/activities/'+id+'/dsl';var p=fetch(url).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});p.catch(function(){});window.__NCA_DSL_PREFETCH__={url:url,promise:p}}catch(e){}})();`;
  return {
    name: 'nca-dsl-prefetch',
    transformIndexHtml(_html, ctx) {
      if (ctx.path !== '/index.html') return;
      return [
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: new URL(apiBase).origin, crossorigin: '' },
          injectTo: 'head',
        },
        { tag: 'script', children: script, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  // 与 runtime/api-base.ts 同一个来源，内联脚本拼出的地址才和 loader 对得上
  plugins: [
    react(),
    dslPrefetch(
      loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE ?? 'http://localhost:3100/api/v1',
    ),
  ],
  resolve: {
    /**
     * 工作区包直接指向 TS 源码，而不是各自的 dist。
     * 后端要 CJS、浏览器要 ESM，靠双格式构建去调和很脆；
     * 让 Vite 直接编译源码更稳，顺带拿到跨包 HMR。
     * 顺序敏感：子路径别名必须排在包名别名之前。
     */
    alias: [
      { find: '@nca/materials/styles.css', replacement: `${pkg('materials')}/styles.css` },
      { find: '@nca/materials', replacement: pkg('materials') },
      { find: '@nca/dsl', replacement: pkg('dsl') },
      { find: '@nca/shared', replacement: pkg('shared') },
    ],
  },
  // strictPort：设计器 iframe 按固定地址加载渲染器，端口被占时必须直接失败，
  // 而不是悄悄漂到别的端口让画布空白
  server: { port: 5180, strictPort: true },
  build: {
    // 活动页体积敏感：产物带 hash，便于 manifest.entry 引用与长缓存。
    // React 全家桶拆成独立 chunk——换物料/改业务不重下框架，也摊薄首包。
    rollupOptions: {
      output: {
        entryFileNames: 'renderer.[hash].js',
        chunkFileNames: 'chunk-[name].[hash].js',
        assetFileNames: 'renderer.[hash][extname]',
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
}));

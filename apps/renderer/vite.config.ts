import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  server: { port: 5174 },
  build: {
    // 活动页体积敏感：产物带 hash，便于 manifest.entry 引用与长缓存
    rollupOptions: {
      output: {
        entryFileNames: 'renderer.[hash].js',
        assetFileNames: 'renderer.[hash][extname]',
      },
    },
  },
});

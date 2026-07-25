import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 与 renderer 一致：工作区包指向 TS 源码，设计器与渲染器共用同一份物料实现
    alias: [
      { find: '@nca/materials/styles.css', replacement: `${pkg('materials')}/styles.css` },
      { find: '@nca/materials', replacement: pkg('materials') },
      { find: '@nca/dsl', replacement: pkg('dsl') },
      { find: '@nca/shared', replacement: pkg('shared') },
    ],
  },
  server: { port: 5173, strictPort: true },
});

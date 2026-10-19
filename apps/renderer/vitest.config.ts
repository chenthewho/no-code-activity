import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// vite.config 导出的是按 mode 求值的函数，先求出 test 模式下的配置再合并
export default defineConfig((env) =>
  mergeConfig(viteConfig({ ...env, mode: 'test' }), {
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  }),
);

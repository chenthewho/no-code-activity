import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@nca/materials/styles.css';
import './styles.css';
import { App } from './bootstrap/App';
import { installMockMiniProgram } from './dev/mock-wx';

// 宿主模拟器用的假小程序环境；生产构建里 import.meta.env.DEV 为 false，整段被摇掉
if (import.meta.env.DEV) installMockMiniProgram();

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少挂载节点 #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

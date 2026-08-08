import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from '@tanstack/react-router';
import { PERMISSION, type Permission } from '@nca/shared';
import { AppLayout } from '../components/AppLayout';
import { LoginPage } from './LoginPage';
import { ActivityListPage } from './ActivityListPage';
import { ActivityDetailPage } from './ActivityDetailPage';
import { DesignerPage } from './DesignerPage';
import { TemplateListPage } from './TemplateListPage';
import { AiWorkbenchPage } from './AiWorkbenchPage';
import { AuditLogPage } from './AuditLogPage';
import { useAuthStore } from '../stores/auth';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

/**
 * 路由守卫。
 *
 * beforeLoad 里必须先等 restore() 完成再判断登录态——否则刷新页面时
 * store 还是初始的 user: null，会把已登录用户弹回登录页。
 */
async function requireAuth(permissions: Permission[] = []) {
  const store = useAuthStore.getState();
  if (store.initializing) {
    await store.restore();
  }
  const current = useAuthStore.getState();
  if (!current.user) {
    throw redirect({ to: '/login', search: { redirect: window.location.pathname } });
  }
  if (permissions.length > 0 && !current.can(...permissions)) {
    throw redirect({ to: '/activities' });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
});

/** 需要登录的页面统一挂在这个布局路由下，守卫只写一次 */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: AppLayout,
  beforeLoad: () => requireAuth(),
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/activities' });
  },
});

const activityListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/activities',
  component: ActivityListPage,
  beforeLoad: () => requireAuth([PERMISSION.ACTIVITY_VIEW]),
});

const activityDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/activities/$activityId',
  component: ActivityDetailPage,
  beforeLoad: () => requireAuth([PERMISSION.ACTIVITY_VIEW]),
});

const templateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/templates',
  component: TemplateListPage,
  beforeLoad: () => requireAuth([PERMISSION.TEMPLATE_VIEW]),
});

const aiRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/ai',
  component: AiWorkbenchPage,
  beforeLoad: () => requireAuth([PERMISSION.AI_USE]),
});

const auditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/audit',
  component: AuditLogPage,
  beforeLoad: () => requireAuth([PERMISSION.SYSTEM_MANAGE]),
});

/** 设计器铺满全屏，不套后台布局 */
const designerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/designer/$activityId',
  component: DesignerPage,
  beforeLoad: () => requireAuth([PERMISSION.ACTIVITY_EDIT]),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  designerRoute,
  authedRoute.addChildren([
    indexRoute,
    activityListRoute,
    activityDetailRoute,
    templateRoute,
    aiRoute,
    auditRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

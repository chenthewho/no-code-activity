import type { ActivityAccess, ActivityStatus, Permission } from './constants';

/** 统一响应包装，Nest 拦截器产出、Admin/Renderer 请求层解包 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
  traceId?: string;
}

export interface PageQuery {
  page: number;
  pageSize: number;
  keyword?: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CurrentUser {
  id: string;
  username: string;
  nickname: string;
  avatar?: string;
  roles: string[];
  permissions: Permission[];
}

/** C 端登录用户，即活动页表达式里 user 命名空间的来源 */
export interface RuntimeUserProfile {
  id: string;
  /** 身份来源：sso / wechat_mp / 宿主类型 */
  provider: string;
  nickname?: string;
  avatar?: string;
}

/** C 端可用的登录方式，渲染器据此决定「登录」动作走哪条路 */
export interface RuntimeAuthConfig {
  sso: boolean;
  ssoLabel: string;
  /** 宿主 code 换身份是否开启 */
  hostLogin: boolean;
  /** 小程序 web-view 外层换票是否开启 */
  wechatMp: boolean;
}

/** C 端换票结果 */
export interface RuntimeLoginResult {
  token: string;
  user: RuntimeUserProfile;
}

export interface ActivitySummary {
  id: string;
  title: string;
  status: ActivityStatus;
  cover?: string;
  startTime?: string;
  endTime?: string;
  publishedVersion?: number;
  ownerId: string;
  ownerName?: string;
  /** 当前用户对该活动的访问级别 */
  access?: ActivityAccess;
  createdAt: string;
  updatedAt: string;
}

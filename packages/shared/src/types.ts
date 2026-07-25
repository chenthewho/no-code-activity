import type { ActivityStatus, Permission } from './constants';

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
  createdAt: string;
  updatedAt: string;
}

import type { ActivityAccess } from '@nca/shared';

/**
 * 活动数据权限在前端的镜像，只决定按钮显隐——真正的拦截在服务端 ActivityAccessGuard。
 * 规则与服务端 satisfies() 一致：负责人与 activity:all 什么都能做，编辑成员能改，只读成员只能看。
 */
export function canEditActivity(access?: ActivityAccess | null): boolean {
  return access === 'all' || access === 'owner' || access === 'editor';
}

/** 删活动、管成员、转交负责人 */
export function canManageActivity(access?: ActivityAccess | null): boolean {
  return access === 'all' || access === 'owner';
}

export const ACCESS_LABEL: Record<ActivityAccess, string> = {
  all: '全部活动',
  owner: '负责人',
  editor: '可编辑',
  viewer: '只读',
};

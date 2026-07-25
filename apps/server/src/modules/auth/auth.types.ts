import type { Permission } from '@nca/shared';

export interface JwtPayload {
  sub: string;
  username: string;
  nickname: string;
  roles: string[];
  permissions: Permission[];
}

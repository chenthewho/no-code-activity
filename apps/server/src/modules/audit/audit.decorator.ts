import { SetMetadata } from '@nestjs/common';

export interface AuditOptions {
  /** 语义动作，如 activity.publish / prize.create */
  action: string;
  /** 取哪个 URL 参数做 targetId，如 'id' */
  targetParam?: string;
}

export const AUDIT_METADATA = 'nca:audit';

/**
 * 标记一个控制器方法需要审计。成功返回后由全局 AuditInterceptor 落一条记录，
 * 记录谁在何时对哪个资源做了什么、请求体是什么。
 */
export function Audit(options: AuditOptions) {
  return SetMetadata(AUDIT_METADATA, options);
}

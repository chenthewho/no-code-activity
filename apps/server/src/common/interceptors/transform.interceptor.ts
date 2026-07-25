import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { ApiResponse } from '@nca/shared';
import { map, type Observable } from 'rxjs';

export const RAW_RESPONSE = Symbol('nca:rawResponse');

/** 统一响应包装。C 端 CDN 直读的 JSON（DSL/manifest）需绕开，用 markRaw 标记 */
export function markRaw<T extends object>(payload: T): T {
  Object.defineProperty(payload, RAW_RESPONSE, { value: true, enumerable: false });
  return payload;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (data !== null && typeof data === 'object' && RAW_RESPONSE in data) {
          return data;
        }
        return { code: 0, message: 'ok', data };
      }),
    );
  }
}

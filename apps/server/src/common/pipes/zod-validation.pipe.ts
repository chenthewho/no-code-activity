import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * 用 zod 做入参校验，而不是 class-validator：
 * 这样后端 DTO 与前端表单、DSL 校验共用同一套 schema 与同一份错误语义。
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: '参数校验失败',
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

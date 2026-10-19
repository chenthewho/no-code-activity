import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '服务器内部错误';
    let errors: unknown;
    /** 机器可读的原因码，如 LOGIN_REQUIRED——客户端按它分支，不去匹配中文文案 */
    let reason: string | undefined;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        message = typeof record.message === 'string' ? record.message : exception.message;
        errors = record.errors;
        if (typeof record.reason === 'string') reason = record.reason;
      }
    } else if (exception instanceof Error) {
      // 未预期的异常不把内部细节回给客户端，只写日志
      this.logger.error(`${request.method} ${request.url} - ${exception.message}`, exception.stack);
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
      ...(errors ? { errors } : {}),
      ...(reason ? { reason } : {}),
    });
  }
}

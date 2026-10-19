import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSION, type AiEvent } from '@nca/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActivityAccessService } from '../access/activity-access.service';
import type { JwtPayload } from '../auth/auth.types';
import { AiService } from './ai.service';
import {
  editSchema,
  startRunSchema,
  streamSchema,
  type EditDto,
  type StartRunDto,
  type StreamDto,
} from './ai.dto';

@ApiTags('ai')
@Controller('ai')
// 忘了这行的话 @RequirePermissions 会静默失效，只剩登录校验——
// 对「发布必须授权」来说这是个安全洞，不是小疏忽
@UseGuards(PermissionsGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly access: ActivityAccessService,
  ) {}

  @Post('runs')
  @ApiOperation({ summary: '创建一次 AI 运行' })
  @RequirePermissions(PERMISSION.AI_USE)
  async start(
    @Body(new ZodValidationPipe(startRunSchema)) dto: StartRunDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // AI 会改写绑定活动的草稿，等同于编辑它；不绑定活动时由工作流自己建新活动
    if (dto.activityId) await this.access.assert(user, dto.activityId, 'edit');
    return this.ai.start(dto, user.sub);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: '运行详情：断线重连时用它补齐前情' })
  @RequirePermissions(PERMISSION.AI_USE)
  detail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ai.detail(id, user.sub);
  }

  /**
   * 驱动运行并流式回传。没带 resume 就是从头跑，带了就是从断点续——
   * 对 LangGraph 来说本来就是同一件事，没必要拆成两个接口。
   */
  @Post('runs/:id/stream')
  @ApiOperation({ summary: '执行/恢复运行，SSE 流式返回' })
  @RequirePermissions(PERMISSION.AI_USE)
  async stream(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(streamSchema)) dto: StreamDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipe(res, this.ai.run(id, user.sub, user.permissions ?? [], dto.resume));
  }

  @Post('edit/stream')
  @ApiOperation({ summary: '设计器内的局部编辑，SSE 流式返回补丁与结果 DSL' })
  @RequirePermissions(PERMISSION.AI_USE)
  async edit(
    @Body(new ZodValidationPipe(editSchema)) dto: EditDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    // 必须在 SSE 开流之前校验：响应头一旦发出，就只能在流里报错了
    await this.access.assert(user, dto.activityId, 'edit');
    await this.pipe(res, this.ai.edit(dto, user.sub, user.permissions ?? []));
  }

  /**
   * 手写 SSE 而不是用 @Sse：
   * 全局的 TransformInterceptor 会把每个事件对象包成 {code,message,data}，
   * AllExceptionsFilter 又会在流中途 res.status().json()——那时响应头早已发出，
   * 只会得到一个二次写入的报错。手写这条路把两者都绕开。
   */
  private async pipe(res: Response, events: AsyncGenerator<AiEvent>): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx 默认会缓冲，不关掉的话「流式」实际是一次性吐出来
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (event: AiEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of events) {
        write(event);
        if (res.writableEnded) break;
      }
    } catch (err) {
      // 这里绝不能往上抛：响应头已经发出去了
      write({ type: 'error', message: err instanceof Error ? err.message : '生成失败' });
    } finally {
      res.end();
    }
  }
}

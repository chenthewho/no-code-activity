import { Controller, Get, HttpException, Logger, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { escapeHtml } from './html';
import { SsoService } from './sso.service';

@ApiTags('sso')
@Controller('sso')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(private readonly sso: SsoService) {}

  /**
   * IdP 回调。这是浏览器整页跳转过来的，出错时回一张能看懂的页面，
   * 而不是一段 JSON——用户此刻既不在活动页也不在后台，没有别的地方能展示错误。
   */
  @Public()
  @Get('callback')
  @ApiOperation({ summary: 'OIDC 回调：换令牌 → 取身份 → 签一次性票据 → 跳回发起方' })
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      this.renderError(res, 400, errorDescription ?? error);
      return;
    }
    try {
      const target = await this.sso.complete(code, state);
      res.redirect(302, target);
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 502;
      const message = err instanceof Error ? err.message : '登录失败';
      this.logger.warn(`SSO 回调失败：${message}`);
      this.renderError(res, status, message);
    }
  }

  private renderError(res: Response, status: number, message: string): void {
    res
      .status(status)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>登录失败</title><body style="font-family:system-ui;padding:40px 24px;color:#333">` +
          `<h3>登录失败</h3><p>${escapeHtml(message)}</p>` +
          `<p><a href="javascript:history.go(-2)">返回</a></p></body>`,
      );
  }
}

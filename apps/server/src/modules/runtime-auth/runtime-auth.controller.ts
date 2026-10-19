import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HOST_TYPE } from '@nca/shared';
import { z } from 'zod';
import { Public } from '../../common/decorators';
import { markRaw } from '../../common/interceptors/transform.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RuntimeAuthService, type RuntimeTokenPayload } from './runtime-auth.service';
import { RuntimeUser, RuntimeUserGuard } from './runtime-user.guard';

const exchangeSchema = z.object({
  ticket: z.string().min(1).max(128),
  /** 发起登录时存在 sessionStorage 里的 nonce */
  nonce: z.string().max(128).optional(),
  /** 当前宿主，小程序票据只认小程序宿主 */
  host: z.string().max(32).optional(),
});

/** 浏览器宿主走 SSO 跳转，不经这里 */
const hostLoginSchema = z.object({
  host: z.enum([
    HOST_TYPE.GAME_CENTER,
    HOST_TYPE.LDQ_PC,
    HOST_TYPE.LDQ_APP,
    HOST_TYPE.SDK_LANDSCAPE,
    HOST_TYPE.SDK_PORTRAIT,
    HOST_TYPE.WECHAT_MINI_PROGRAM,
  ]),
  code: z.string().min(1).max(512),
});

const wechatSchema = z.object({ code: z.string().min(1).max(256) });

/**
 * C 端登录。全部 @Public——这里本身就是「还没登录」时要调的接口；
 * 返回体 markRaw，渲染器不需要认识后台那套 { code, data } 包装。
 */
@ApiTags('runtime')
@Controller('runtime/auth')
export class RuntimeAuthController {
  constructor(private readonly auth: RuntimeAuthService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'C 端可用的登录方式' })
  config() {
    return markRaw(this.auth.authConfig());
  }

  @Public()
  @Get('sso/authorize')
  @ApiOperation({ summary: '发起统一登录：302 到 IdP，登录后带 nca_ticket 跳回 redirect' })
  async authorize(
    @Query('redirect') redirect: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.auth.beginSso(redirect, nonce));
  }

  @Public()
  @Post('exchange')
  @HttpCode(200)
  @ApiOperation({ summary: '一次性票据换 C 端 token' })
  async exchange(
    @Body(new ZodValidationPipe(exchangeSchema)) dto: z.infer<typeof exchangeSchema>,
    @Ip() ip?: string,
  ) {
    return markRaw(await this.auth.exchange(dto.ticket, ip, { nonce: dto.nonce, host: dto.host }));
  }

  @Public()
  @Post('host-login')
  @HttpCode(200)
  @ApiOperation({ summary: '宿主登录：桥接拉起宿主登录拿到的 code 换 C 端 token' })
  async hostLogin(
    @Body(new ZodValidationPipe(hostLoginSchema)) dto: z.infer<typeof hostLoginSchema>,
    @Ip() ip?: string,
  ) {
    return markRaw(await this.auth.hostLogin(dto.host, dto.code, ip));
  }

  @Public()
  @Post('wechat-mp')
  @HttpCode(200)
  @ApiOperation({ summary: '小程序外层用 wx.login 的 code 换票据，拼进 web-view 地址' })
  async wechatMp(
    @Body(new ZodValidationPipe(wechatSchema)) dto: { code: string },
    @Ip() ip?: string,
  ) {
    return markRaw(await this.auth.wechatMpTicket(dto.code, ip));
  }

  @Public()
  @Get('me')
  @UseGuards(RuntimeUserGuard)
  @ApiOperation({ summary: '当前 C 端登录用户' })
  async me(@RuntimeUser() user: RuntimeTokenPayload | null) {
    if (!user) throw new UnauthorizedException('未登录');
    return markRaw(await this.auth.me(user));
  }
}

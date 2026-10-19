import { Body, Controller, Get, HttpCode, Post, Query, Res, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '@nca/shared';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { JwtPayload } from './auth.types';

const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});
type LoginDto = z.infer<typeof loginSchema>;

const ssoExchangeSchema = z.object({ ticket: z.string().min(1).max(128) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '账号密码登录' })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginDto): Promise<{ token: string; user: CurrentUserType }> {
    const payload = await this.auth.validateUser(dto.username, dto.password);
    const token = await this.auth.issueToken(payload);
    const user = await this.auth.getProfile(payload.sub);
    return { token, user };
  }

  @Public()
  @Get('sso/config')
  @ApiOperation({ summary: '后台是否开启统一登录' })
  ssoConfig() {
    return this.auth.ssoConfig();
  }

  @Public()
  @Get('sso/authorize')
  @ApiOperation({ summary: '后台统一登录：302 到 IdP，回来后带 sso_ticket 到登录页' })
  async ssoAuthorize(
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.auth.beginSso(redirect));
  }

  @Public()
  @Post('sso/exchange')
  @HttpCode(200)
  @ApiOperation({ summary: '用 SSO 一次性票据换后台 token' })
  @UsePipes(new ZodValidationPipe(ssoExchangeSchema))
  ssoExchange(@Body() dto: { ticket: string }): Promise<{ token: string; user: CurrentUserType }> {
    return this.auth.exchangeSsoTicket(dto.ticket);
  }

  @Get('me')
  @ApiOperation({ summary: '获取当前登录用户与权限码' })
  async me(@CurrentUser() user: JwtPayload): Promise<CurrentUserType> {
    return this.auth.getProfile(user.sub);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { markRaw } from '../../common/interceptors/transform.interceptor';
import { RedisService } from '../../common/redis/redis.service';
import { escapeHtml } from './html';
import { pkceChallenge, randomToken } from './oidc.client';
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, SsoService } from './sso.service';

interface MockUser {
  sub: string;
  preferred_username: string;
  name: string;
  picture?: string;
}

interface IssuedCode {
  redirectUri: string;
  challenge: string;
  user: MockUser;
}

const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * 模拟 IdP：只在 SSO_PROVIDER=mock 时响应，其余情况一律 404。
 *
 * 它是一个真按 OIDC 授权码 + PKCE 协议说话的小 IdP，而不是在服务端里
 * 走捷径直接认人——这样本地跑的就是对接真实 IdP 时的同一套客户端代码，
 * 换成 oidc 只是换几个地址。
 */
@ApiExcludeController()
@Controller('sso-mock')
export class MockIdpController {
  constructor(
    private readonly sso: SsoService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('.well-known/openid-configuration')
  discovery() {
    this.assertEnabled();
    const base = `${this.sso.apiBase}/sso-mock`;
    return markRaw({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      userinfo_endpoint: `${base}/userinfo`,
      code_challenge_methods_supported: ['S256'],
    });
  }

  /** 登录页：填个用户名就算登录成功 */
  @Public()
  @Get('authorize')
  authorizePage(@Query() query: Record<string, string>, @Res() res: Response): void {
    this.assertEnabled();
    if (query.client_id !== MOCK_CLIENT_ID) throw new BadRequestException('client_id 不匹配');
    if (query.code_challenge_method !== 'S256' || !query.code_challenge) {
      throw new BadRequestException('必须使用 PKCE（S256）');
    }
    const hidden = ['redirect_uri', 'state', 'code_challenge']
      .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(query[key] ?? '')}">`)
      .join('');
    res
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>模拟统一登录</title>` +
          `<body style="font-family:system-ui;max-width:360px;margin:48px auto;padding:0 20px;color:#333">` +
          `<h3>模拟统一登录</h3>` +
          `<p style="color:#999;font-size:13px">本地联调用的模拟 IdP，任意用户名即可登录。</p>` +
          `<form method="post" action="authorize">${hidden}` +
          `<p><label>用户名<br><input name="username" required value="tester" style="width:100%;padding:8px"></label></p>` +
          `<p><label>昵称<br><input name="nickname" value="测试用户" style="width:100%;padding:8px"></label></p>` +
          `<p><button type="submit" style="width:100%;padding:10px;background:#1677ff;color:#fff;border:0;border-radius:6px">登录</button></p>` +
          `</form></body>`,
      );
  }

  @Public()
  @Post('authorize')
  async authorize(@Body() body: Record<string, string>, @Res() res: Response): Promise<void> {
    this.assertEnabled();
    const username = (body.username ?? '').trim();
    if (!username || !body.redirect_uri || !body.state || !body.code_challenge) {
      throw new BadRequestException('登录参数不完整');
    }
    const code = randomToken();
    const issued: IssuedCode = {
      redirectUri: body.redirect_uri,
      challenge: body.code_challenge,
      user: {
        sub: `mock_${username}`,
        preferred_username: username,
        name: (body.nickname ?? '').trim() || username,
      },
    };
    await this.redis.set(`nca:sso-mock:code:${code}`, JSON.stringify(issued), CODE_TTL_MS);

    const target = new URL(body.redirect_uri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', body.state);
    res.redirect(302, target.toString());
  }

  @Public()
  @Post('token')
  @HttpCode(200)
  async token(@Body() body: Record<string, string>) {
    this.assertEnabled();
    if (body.grant_type !== 'authorization_code')
      throw new BadRequestException('unsupported_grant_type');
    if (body.client_id !== MOCK_CLIENT_ID || body.client_secret !== MOCK_CLIENT_SECRET) {
      throw new UnauthorizedException('invalid_client');
    }
    const raw = await this.redis.take(`nca:sso-mock:code:${body.code ?? ''}`);
    if (!raw) throw new BadRequestException('invalid_grant');
    const issued = JSON.parse(raw) as IssuedCode;
    if (issued.redirectUri !== body.redirect_uri)
      throw new BadRequestException('redirect_uri 不匹配');
    if (!body.code_verifier || pkceChallenge(body.code_verifier) !== issued.challenge) {
      throw new BadRequestException('PKCE 校验失败');
    }

    const accessToken = randomToken();
    await this.redis.set(
      `nca:sso-mock:token:${accessToken}`,
      JSON.stringify(issued.user),
      TOKEN_TTL_MS,
    );
    return markRaw({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_MS / 1000,
    });
  }

  @Public()
  @Get('userinfo')
  async userinfo(@Headers('authorization') authorization?: string) {
    this.assertEnabled();
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const raw = token ? await this.redis.get(`nca:sso-mock:token:${token}`) : null;
    if (!raw) throw new UnauthorizedException('invalid_token');
    return markRaw(JSON.parse(raw) as MockUser);
  }

  private assertEnabled(): void {
    if (this.sso.provider !== 'mock') throw new NotFoundException();
  }
}

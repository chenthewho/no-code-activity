import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { RuntimeAuthConfig, RuntimeLoginResult, RuntimeUserProfile } from '@nca/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { OidcProfile } from '../sso/oidc.client';
import { SsoService } from '../sso/sso.service';
import { parseMockCode, verifyByHttp, wechatCode2Session, type HostIdentity } from './host-auth';

/** C 端 token 的载荷。aud 固定，和后台 token 从签名到受众都对不上 */
export interface RuntimeTokenPayload {
  sub: string;
  provider: string;
  nickname?: string;
  avatar?: string;
}

const RUNTIME_AUDIENCE = 'nca-runtime';

/** C 端一次性票据的内容：SSO 发起的绑定浏览器 nonce，小程序换的标记来源 */
interface RuntimeTicket {
  userId: string;
  nonce?: string;
  source?: 'wechat_mp';
}
/** 换票 / 宿主登录按 IP 限流，挡住穷举票据与刷号 */
const LOGIN_ATTEMPTS_PER_MINUTE = 60;

interface RuntimeUserRow {
  id: string;
  provider: string;
  nickname: string | null;
  avatar: string | null;
}

@Injectable()
export class RuntimeAuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly sso: SsoService,
  ) {}

  onModuleInit(): void {
    this.sso.register('runtime', (profile, redirect, nonce) =>
      this.completeSso(profile, redirect, nonce),
    );
  }

  authConfig(): RuntimeAuthConfig {
    return {
      sso: this.sso.enabled,
      ssoLabel: this.sso.label,
      hostLogin: this.config.get<string>('HOST_AUTH_MODE') !== 'none',
      wechatMp:
        Boolean(
          this.config.get<string>('WECHAT_MP_APPID') && this.config.get<string>('WECHAT_MP_SECRET'),
        ) || this.config.get<string>('HOST_AUTH_MODE') === 'mock',
    };
  }

  /** 发起 SSO：跳回地址必须落在白名单源上，否则就是一个开放重定向 */
  async beginSso(redirect: string | undefined, nonce: string | undefined): Promise<string> {
    return this.sso.begin('runtime', this.assertRedirect(redirect), nonce);
  }

  /** IdP 认证通过：建号，签一次性票据挂在跳回地址上 */
  private async completeSso(profile: OidcProfile, redirect: string, nonce: string): Promise<string> {
    const user = await this.upsertUser('sso', {
      externalId: profile.id,
      nickname: profile.nickname,
      avatar: profile.avatar,
    });
    const ticket = await this.sso.issueTicket('runtime', { userId: user.id, nonce } satisfies RuntimeTicket);
    const target = new URL(redirect);
    target.searchParams.set('nca_ticket', ticket);
    return target.toString();
  }

  /**
   * 活动页拿回跳 URL 上的票据换 token。SSO 票据核对发起浏览器的 nonce；
   * 小程序票据没有浏览器 nonce 可绑，只允许在小程序宿主里换——转发到普通浏览器里打开无效。
   */
  async exchange(
    ticket: string,
    ip?: string,
    binding: { nonce?: string; host?: string } = {},
  ): Promise<RuntimeLoginResult> {
    await this.throttle(ip);
    const { userId, source } = await this.sso.consumeTicket<RuntimeTicket>('runtime', ticket, binding.nonce);
    if (source === 'wechat_mp' && binding.host !== 'wechat_mini_program') {
      throw new BadRequestException('该登录票据只能在小程序内使用');
    }
    const user = await this.prisma.runtimeUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return this.loginResult(user);
  }

  /** 宿主登录：桥接给的 code 拿去宿主账号服务换身份 */
  async hostLogin(host: string, code: string, ip?: string): Promise<RuntimeLoginResult> {
    await this.throttle(ip);
    const identity = await this.verifyHostCode(host, code);
    const user = await this.upsertUser(host, identity);
    return this.loginResult(user);
  }

  /**
   * 小程序：外层页面 wx.login 拿 code 来换一张票据，再把票据拼进 web-view 的地址。
   * 返回票据而不是 token：票据进 URL 后 60 秒即失效，token 进 URL 则长期有效。
   */
  async wechatMpTicket(code: string, ip?: string): Promise<{ ticket: string; expiresIn: number }> {
    await this.throttle(ip);
    const identity = await this.verifyWechatCode(code);
    const user = await this.upsertUser('wechat_mp', identity);
    const ticket = await this.sso.issueTicket('runtime', {
      userId: user.id,
      source: 'wechat_mp',
    } satisfies RuntimeTicket);
    return { ticket, expiresIn: 60 };
  }

  async me(payload: RuntimeTokenPayload): Promise<RuntimeUserProfile> {
    const user = await this.prisma.runtimeUser.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('登录已失效');
    return toProfile(user);
  }

  /** 从请求头解析 C 端身份；没带、过期、签名不对一律视为未登录，由调用方决定要不要拦 */
  async fromAuthorization(header: string | undefined): Promise<RuntimeTokenPayload | null> {
    if (!header?.startsWith('Bearer ')) return null;
    try {
      return await this.jwt.verifyAsync<RuntimeTokenPayload>(header.slice(7), {
        secret: this.secret,
        audience: RUNTIME_AUDIENCE,
      });
    } catch {
      return null;
    }
  }

  async issueToken(user: RuntimeUserRow): Promise<string> {
    const payload: RuntimeTokenPayload = {
      sub: user.id,
      provider: user.provider,
      ...(user.nickname ? { nickname: user.nickname } : {}),
    };
    return this.jwt.signAsync(payload, {
      secret: this.secret,
      audience: RUNTIME_AUDIENCE,
      // 格式已在 configuration.ts 校验；ms 的 StringValue 无法从环境变量静态收窄
      expiresIn: (this.config.get<string>('RUNTIME_JWT_EXPIRES_IN') ?? '30d') as never,
    });
  }

  private get secret(): string {
    // 从后台密钥派生而不是直接复用：两种 token 的签名互不通用
    return (
      this.config.get<string>('RUNTIME_JWT_SECRET') ??
      `${this.config.getOrThrow<string>('JWT_SECRET')}:runtime`
    );
  }

  private async loginResult(user: RuntimeUserRow): Promise<RuntimeLoginResult> {
    return { token: await this.issueToken(user), user: toProfile(user) };
  }

  private async upsertUser(provider: string, identity: HostIdentity): Promise<RuntimeUserRow> {
    const now = new Date();
    return this.prisma.runtimeUser.upsert({
      where: { provider_externalId: { provider, externalId: identity.externalId } },
      create: {
        provider,
        externalId: identity.externalId,
        nickname: identity.nickname ?? null,
        avatar: identity.avatar ?? null,
        lastLoginAt: now,
      },
      // 昵称头像以来源系统最新值为准；来源没给就别拿 null 覆盖掉旧值
      update: {
        lastLoginAt: now,
        ...(identity.nickname ? { nickname: identity.nickname } : {}),
        ...(identity.avatar ? { avatar: identity.avatar } : {}),
      },
    });
  }

  private async verifyHostCode(host: string, code: string): Promise<HostIdentity> {
    const mode = this.config.get<string>('HOST_AUTH_MODE');
    if (mode === 'mock') {
      const identity = parseMockCode(code);
      if (!identity) throw new BadRequestException('模拟宿主登录的 code 形如 mock:<userId>');
      return identity;
    }
    if (mode === 'http') {
      try {
        return await verifyByHttp(
          this.config.getOrThrow<string>('HOST_AUTH_VERIFY_URL'),
          host,
          code,
        );
      } catch (err) {
        throw new UnauthorizedException(err instanceof Error ? err.message : '宿主登录校验失败');
      }
    }
    throw new BadRequestException('未开启宿主登录');
  }

  private async verifyWechatCode(code: string): Promise<HostIdentity> {
    const appId = this.config.get<string>('WECHAT_MP_APPID');
    const secret = this.config.get<string>('WECHAT_MP_SECRET');
    if (appId && secret) {
      try {
        return await wechatCode2Session(appId, secret, code);
      } catch (err) {
        throw new UnauthorizedException(err instanceof Error ? err.message : '微信登录失败');
      }
    }
    if (this.config.get<string>('HOST_AUTH_MODE') === 'mock') {
      const identity = parseMockCode(code);
      if (identity) return identity;
    }
    throw new BadRequestException('未配置小程序登录（WECHAT_MP_APPID / WECHAT_MP_SECRET）');
  }

  private assertRedirect(redirect: string | undefined): string {
    if (!redirect) throw new BadRequestException('缺少登录后的跳回地址');
    let url: URL;
    try {
      url = new URL(redirect);
    } catch {
      throw new BadRequestException('跳回地址不是合法 URL');
    }
    if (!this.allowedOrigins().has(url.origin)) {
      throw new BadRequestException(
        `不允许跳回 ${url.origin}，请在 RUNTIME_REDIRECT_ORIGINS 中登记`,
      );
    }
    // 上一轮没换掉的旧票据不能跟着再走一圈
    url.searchParams.delete('nca_ticket');
    return url.toString();
  }

  private allowedOrigins(): Set<string> {
    const origins = new Set<string>();
    const base = this.config.get<string>('ACTIVITY_BASE_URL');
    if (base) origins.add(new URL(base).origin);
    for (const item of (this.config.get<string>('RUNTIME_REDIRECT_ORIGINS') ?? '').split(',')) {
      const trimmed = item.trim();
      if (trimmed) origins.add(new URL(trimmed).origin);
    }
    return origins;
  }

  private async throttle(ip?: string): Promise<void> {
    const count = await this.redis.incrWithExpire(`nca:runtime-login:${ip ?? 'unknown'}`, 60_000);
    if (count > LOGIN_ATTEMPTS_PER_MINUTE) {
      throw new HttpException('登录请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function toProfile(user: RuntimeUserRow): RuntimeUserProfile {
  return {
    id: user.id,
    provider: user.provider,
    ...(user.nickname ? { nickname: user.nickname } : {}),
    ...(user.avatar ? { avatar: user.avatar } : {}),
  };
}

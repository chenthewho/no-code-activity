import { Global, Module } from '@nestjs/common';
import { MockIdpController } from './mock-idp.controller';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

/**
 * 统一登录。C 端与后台共用同一个 OIDC 客户端和回调地址，
 * 各自的建号逻辑以回调处理器的形式注册进来。
 */
@Global()
@Module({
  controllers: [SsoController, MockIdpController],
  providers: [SsoService],
  exports: [SsoService],
})
export class SsoModule {}

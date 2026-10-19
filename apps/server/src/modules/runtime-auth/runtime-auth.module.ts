import { Module } from '@nestjs/common';
import { RuntimeAuthController } from './runtime-auth.controller';
import { RuntimeAuthService } from './runtime-auth.service';
import { RuntimeUserGuard } from './runtime-user.guard';

/** C 端登录：SSO 回跳换票、宿主 code 换身份、小程序换票，签发 C 端 token */
@Module({
  controllers: [RuntimeAuthController],
  providers: [RuntimeAuthService, RuntimeUserGuard],
  exports: [RuntimeAuthService, RuntimeUserGuard],
})
export class RuntimeAuthModule {}

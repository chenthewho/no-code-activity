import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/configuration';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AssetModule } from './modules/asset/asset.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChannelModule } from './modules/channel/channel.module';
import { MaterialModule } from './modules/material/material.module';
import { PrizeModule } from './modules/prize/prize.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { RuntimeAuthModule } from './modules/runtime-auth/runtime-auth.module';
import { SsoModule } from './modules/sso/sso.module';
import { StorageModule } from './modules/storage/storage.module';
import { TemplateModule } from './modules/template/template.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    SsoModule,
    AuthModule,
    RuntimeAuthModule,
    ActivityModule,
    AnalyticsModule,
    AssetModule,
    AuditModule,
    ChannelModule,
    TemplateModule,
    MaterialModule,
    PrizeModule,
    RuntimeModule,
    AiModule,
  ],
  providers: [
    // 默认全局要求登录，公开接口用 @Public() 显式开口，避免漏加守卫
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/configuration';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AssetModule } from './modules/asset/asset.module';
import { AuthModule } from './modules/auth/auth.module';
import { MaterialModule } from './modules/material/material.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
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
    AuthModule,
    ActivityModule,
    AssetModule,
    TemplateModule,
    MaterialModule,
    RuntimeModule,
  ],
  providers: [
    // 默认全局要求登录，公开接口用 @Public() 显式开口，避免漏加守卫
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

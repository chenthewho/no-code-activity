import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { corsOrigins, parseTrustProxy } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const config = app.get(ConfigService);

  // 让 req.ip 取到真实客户端地址（X-Forwarded-For），按 IP 限流才按人生效
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) app.set('trust proxy', parseTrustProxy(trustProxy));

  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(prefix, {
    // 发布产物走静态托管，不该被套上 API 前缀
    exclude: ['static/(.*)', 'health'],
  });

  app.enableCors({
    origin: corsOrigins(config.get<string>('CORS_ORIGINS', '*')),
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // 本地发布产物托管，让「发布 → 打开活动页」在没有 COS 时也能跑通
  app.useStaticAssets(resolve(config.get<string>('PUBLISH_LOCAL_DIR', './.publish')), {
    prefix: '/static/',
  });

  if (config.get<string>('NODE_ENV') !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('零代码活动页平台 API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${prefix}/docs`, app, doc);
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`服务已启动 http://localhost:${port}/${prefix}`);
}

void bootstrap();

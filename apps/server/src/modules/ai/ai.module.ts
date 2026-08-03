import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnthropicClient } from './llm/anthropic.client';

/**
 * DraftService / PublishService 走 imports 拿，不塞进自己的 providers——
 * 后者会得到另一个实例，发布锁与草稿写入就不在同一条线上了。
 */
@Module({
  imports: [ActivityModule],
  controllers: [AiController],
  providers: [AiService, AnthropicClient],
  exports: [AiService],
})
export class AiModule {}

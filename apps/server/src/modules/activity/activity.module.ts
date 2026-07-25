import { Module } from '@nestjs/common';
import { DraftService } from '../dsl/draft.service';
import { PublishService } from '../publish/publish.service';
import { StorageService } from '../storage/storage.service';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  controllers: [ActivityController],
  providers: [ActivityService, DraftService, PublishService, StorageService],
  exports: [ActivityService, DraftService, PublishService],
})
export class ActivityModule {}

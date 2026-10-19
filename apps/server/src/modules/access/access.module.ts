import { Global, Module } from '@nestjs/common';
import { ActivityAccessGuard } from './activity-access.guard';
import { ActivityAccessService } from './activity-access.service';

/** 活动数据权限：各业务模块的控制器直接 @UseGuards(ActivityAccessGuard) 即可 */
@Global()
@Module({
  providers: [ActivityAccessService, ActivityAccessGuard],
  exports: [ActivityAccessService, ActivityAccessGuard],
})
export class AccessModule {}

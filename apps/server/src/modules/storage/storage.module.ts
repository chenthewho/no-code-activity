import { Global, Module } from '@nestjs/common';
import { CosService } from './cos.service';
import { StorageService } from './storage.service';

/** 对象存储：发布产物与素材共用，全局单例，避免各模块各 new 一份 */
@Global()
@Module({
  providers: [CosService, StorageService],
  exports: [CosService, StorageService],
})
export class StorageModule {}

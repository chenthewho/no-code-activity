import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@nca/shared';
import { RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createPrizeSchema, updatePrizeSchema, type CreatePrizeDto, type UpdatePrizeDto } from './prize.dto';
import { PrizeService } from './prize.service';

@ApiTags('prize')
@Controller('prizes')
@UseGuards(PermissionsGuard)
export class PrizeController {
  constructor(private readonly prizes: PrizeService) {}

  @Get()
  @ApiOperation({ summary: '活动奖品列表（含实时剩余库存）' })
  @RequirePermissions(PERMISSION.ACTIVITY_VIEW)
  list(@Query('activityId') activityId: string) {
    return this.prizes.list(activityId);
  }

  @Post()
  @ApiOperation({ summary: '新建奖品，初始化库存' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  create(@Body(new ZodValidationPipe(createPrizeSchema)) dto: CreatePrizeDto) {
    return this.prizes.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新奖品；改 total 时重置剩余库存' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updatePrizeSchema)) dto: UpdatePrizeDto) {
    return this.prizes.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除奖品（连同中奖记录）' })
  @RequirePermissions(PERMISSION.ACTIVITY_EDIT)
  remove(@Param('id') id: string) {
    return this.prizes.remove(id);
  }
}

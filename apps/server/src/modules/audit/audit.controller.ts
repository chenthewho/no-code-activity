import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@nca/shared';
import { RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';
import { z } from 'zod';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().optional(),
  targetType: z.string().optional(),
});
type ListDto = z.infer<typeof listSchema>;

@ApiTags('audit')
@Controller('audit-logs')
@UseGuards(PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: '操作审计列表（谁在何时对哪个资源做了什么）' })
  @RequirePermissions(PERMISSION.AUDIT_VIEW)
  list(@Query(new ZodValidationPipe(listSchema)) query: ListDto) {
    return this.audit.list(query);
  }
}

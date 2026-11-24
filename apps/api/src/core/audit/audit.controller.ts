import { Controller, Get, Query } from '@nestjs/common';
import {
  listAuditQuerySchema,
  type AuditLogDto,
  type AuditVerifyResult,
  type ListAuditQuery,
  type Paginated,
} from '@lims/shared';
import { Roles } from '../security/decorators';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('audit')
@Roles('ADMIN', 'QUALITE')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listAuditQuerySchema)) query: ListAuditQuery): Promise<Paginated<AuditLogDto>> {
    return this.audit.list(query);
  }

  @Get('verify')
  verify(): Promise<AuditVerifyResult> {
    return this.audit.verify();
  }
}

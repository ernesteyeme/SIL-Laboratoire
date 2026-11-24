import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createPrescriberSchema,
  listPrescribersQuerySchema,
  updatePrescriberSchema,
  type CreatePrescriberInput,
  type ListPrescribersQuery,
  type Paginated,
  type PrescriberDto,
  type UpdatePrescriberInput,
} from '@lims/shared';
import { Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { PrescribersService } from './prescribers.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@Controller('prescribers')
export class PrescribersController {
  constructor(private readonly prescribers: PrescribersService) {}

  @Get()
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  list(@Query(new ZodValidationPipe(listPrescribersQuerySchema)) query: ListPrescribersQuery): Promise<Paginated<PrescriberDto>> {
    return this.prescribers.list(query);
  }

  @Get(':id')
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  get(@Param('id', uuidPipe) id: string): Promise<PrescriberDto> {
    return this.prescribers.get(id);
  }

  @Post()
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  create(@Body(new ZodValidationPipe(createPrescriberSchema)) body: CreatePrescriberInput): Promise<PrescriberDto> {
    return this.prescribers.create(body);
  }

  @Patch(':id')
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updatePrescriberSchema)) body: UpdatePrescriberInput,
  ): Promise<PrescriberDto> {
    return this.prescribers.update(id, body);
  }
}

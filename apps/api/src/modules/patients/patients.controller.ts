import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createPatientSchema,
  duplicateCheckSchema,
  listPatientsQuerySchema,
  patientStatusChangeSchema,
  updatePatientSchema,
  type CreatePatientInput,
  type DuplicateCandidate,
  type DuplicateCheckInput,
  type ListPatientsQuery,
  type Paginated,
  type PatientDto,
  type PatientStatusChangeInput,
  type UpdatePatientInput,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { PatientsService } from './patients.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  list(@Query(new ZodValidationPipe(listPatientsQuerySchema)) query: ListPatientsQuery): Promise<Paginated<PatientDto>> {
    return this.patients.list(query);
  }

  @Get(':id')
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  get(@Param('id', uuidPipe) id: string): Promise<PatientDto> {
    return this.patients.get(id);
  }

  @Post('duplicates')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  duplicates(@Body(new ZodValidationPipe(duplicateCheckSchema)) body: DuplicateCheckInput): Promise<DuplicateCandidate[]> {
    return this.patients.findDuplicates(body);
  }

  @Post()
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  create(
    @Body(new ZodValidationPipe(createPatientSchema)) body: CreatePatientInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<PatientDto> {
    return this.patients.create(body, actor);
  }

  @Patch(':id')
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updatePatientSchema)) body: UpdatePatientInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<PatientDto> {
    return this.patients.update(id, body, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  deactivate(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(patientStatusChangeSchema)) body: PatientStatusChangeInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<PatientDto> {
    return this.patients.deactivate(id, body, actor);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  reactivate(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(patientStatusChangeSchema)) body: PatientStatusChangeInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<PatientDto> {
    return this.patients.reactivate(id, body, actor);
  }
}

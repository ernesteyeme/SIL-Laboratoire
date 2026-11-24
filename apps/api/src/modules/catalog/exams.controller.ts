import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  createExamSchema,
  createParameterSchema,
  deleteWithReasonSchema,
  listExamsQuerySchema,
  referenceRangeSchema,
  updateExamSchema,
  updateParameterSchema,
  type CreateExamInput,
  type CreateParameterInput,
  type DeleteWithReasonInput,
  type ExamDetailDto,
  type ExamListItemDto,
  type ExamParameterDto,
  type ListExamsQuery,
  type Paginated,
  type ReferenceRangeDto,
  type ReferenceRangeInput,
  type UpdateExamInput,
  type UpdateParameterInput,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { AnyRole, CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { ExamsService } from './exams.service';
import { ParametersService } from './parameters.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const TECHNICAL = rolesOf(ROLE_GROUPS.CATALOG_TECHNICAL_WRITE);

@Controller('catalog/exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly parameters: ParametersService,
  ) {}

  @Get()
  @AnyRole()
  list(@Query(new ZodValidationPipe(listExamsQuerySchema)) query: ListExamsQuery): Promise<Paginated<ExamListItemDto>> {
    return this.exams.list(query);
  }

  @Get(':id')
  @AnyRole()
  get(@Param('id', uuidPipe) id: string): Promise<ExamDetailDto> {
    return this.exams.get(id);
  }

  @Post()
  @Roles(...TECHNICAL)
  create(@Body(new ZodValidationPipe(createExamSchema)) body: CreateExamInput): Promise<ExamDetailDto> {
    return this.exams.create(body);
  }

  @Patch(':id')
  @Roles(...TECHNICAL)
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateExamSchema)) body: UpdateExamInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<ExamDetailDto> {
    return this.exams.update(id, body, actor);
  }

  @Post(':id/parameters')
  @Roles(...TECHNICAL)
  addParameter(
    @Param('id', uuidPipe) examId: string,
    @Body(new ZodValidationPipe(createParameterSchema)) body: CreateParameterInput,
  ): Promise<ExamParameterDto> {
    return this.parameters.create(examId, body);
  }
}

@Controller('catalog')
export class ParametersController {
  constructor(private readonly parameters: ParametersService) {}

  @Patch('parameters/:id')
  @Roles(...TECHNICAL)
  updateParameter(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateParameterSchema)) body: UpdateParameterInput,
  ): Promise<ExamParameterDto> {
    return this.parameters.update(id, body);
  }

  @Post('parameters/:id/reference-ranges')
  @Roles(...TECHNICAL)
  addRange(
    @Param('id', uuidPipe) parameterId: string,
    @Body(new ZodValidationPipe(referenceRangeSchema)) body: ReferenceRangeInput,
  ): Promise<ReferenceRangeDto> {
    return this.parameters.createRange(parameterId, body);
  }

  @Put('reference-ranges/:id')
  @Roles(...TECHNICAL)
  updateRange(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(referenceRangeSchema)) body: ReferenceRangeInput,
  ): Promise<ReferenceRangeDto> {
    return this.parameters.updateRange(id, body);
  }

  @Delete('reference-ranges/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...TECHNICAL)
  deleteRange(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(deleteWithReasonSchema)) body: DeleteWithReasonInput,
  ): Promise<void> {
    return this.parameters.deleteRange(id, body);
  }
}

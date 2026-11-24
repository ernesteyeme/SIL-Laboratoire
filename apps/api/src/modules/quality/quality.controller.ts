import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  cancelQualityIssueSchema,
  closeQualityIssueSchema,
  createQualityIssueSchema,
  indicatorsQuerySchema,
  leveyJenningsQuerySchema,
  planQualityIssueSchema,
  qcCorrectiveActionSchema,
  qcExcludeSchema,
  qcMaterialSchema,
  qcRunSchema,
  qcRunsQuerySchema,
  qcTargetSchema,
  qualityIssuesQuerySchema,
  type CancelQualityIssueInput,
  type CloseQualityIssueInput,
  type CreateQualityIssueInput,
  type IndicatorsDto,
  type IndicatorsQuery,
  type LeveyJenningsDto,
  type LeveyJenningsQuery,
  type Paginated,
  type PlanQualityIssueInput,
  type QcCorrectiveActionInput,
  type QcExcludeInput,
  type QcMaterialDto,
  type QcMaterialInput,
  type QcParameterStatusDto,
  type QcRunDetailDto,
  type QcRunDto,
  type QcRunInput,
  type QcRunsQuery,
  type QcTargetDto,
  type QcTargetInput,
  type QualityIssueDto,
  type QualityIssuesQuery,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { AnyRole, CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { IndicatorsService } from './indicators.service';
import { QcService } from './qc.service';
import { QualityIssuesService } from './quality-issues.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const materialsQuerySchema = z.object({ includeInactive: z.enum(['true', 'false']).default('false') });
const statusQuerySchema = z.object({ sectionId: z.string().uuid().optional() });

@Controller('qc')
export class QcController {
  constructor(private readonly qc: QcService) {}

  @Get('materials')
  @Roles(...rolesOf(ROLE_GROUPS.QC_READ))
  materials(@Query(new ZodValidationPipe(materialsQuerySchema)) q: z.infer<typeof materialsQuerySchema>): Promise<QcMaterialDto[]> {
    return this.qc.listMaterials(q.includeInactive === 'true');
  }

  @Post('materials')
  @Roles(...rolesOf(ROLE_GROUPS.QC_CONFIG))
  createMaterial(@Body(new ZodValidationPipe(qcMaterialSchema)) body: QcMaterialInput): Promise<QcMaterialDto> {
    return this.qc.createMaterial(body);
  }

  @Put('materials/:id')
  @Roles(...rolesOf(ROLE_GROUPS.QC_CONFIG))
  updateMaterial(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(qcMaterialSchema)) body: QcMaterialInput): Promise<QcMaterialDto> {
    return this.qc.updateMaterial(id, body);
  }

  /** Crée ou met à jour la cible du matériau pour le paramètre indiqué. */
  @Put('materials/:id/targets')
  @Roles(...rolesOf(ROLE_GROUPS.QC_CONFIG))
  upsertTarget(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(qcTargetSchema)) body: QcTargetInput): Promise<QcTargetDto> {
    return this.qc.upsertTarget(id, body);
  }

  @Get('targets/:id/levey-jennings')
  @Roles(...rolesOf(ROLE_GROUPS.QC_READ))
  leveyJennings(@Param('id', uuidPipe) id: string, @Query(new ZodValidationPipe(leveyJenningsQuerySchema)) q: LeveyJenningsQuery): Promise<LeveyJenningsDto> {
    return this.qc.leveyJennings(id, q);
  }

  /** État du CIQ de chaque paramètre suivi (dernière série, passage du jour, blocage). */
  @Get('status')
  @Roles(...rolesOf(ROLE_GROUPS.QC_READ))
  status(@Query(new ZodValidationPipe(statusQuerySchema)) q: z.infer<typeof statusQuerySchema>): Promise<QcParameterStatusDto[]> {
    return this.qc.parameterStatus(q.sectionId);
  }

  @Get('runs')
  @Roles(...rolesOf(ROLE_GROUPS.QC_READ))
  runs(@Query(new ZodValidationPipe(qcRunsQuerySchema)) q: QcRunsQuery): Promise<Paginated<QcRunDto>> {
    return this.qc.listRuns(q);
  }

  @Get('runs/:id')
  @Roles(...rolesOf(ROLE_GROUPS.QC_READ))
  run(@Param('id', uuidPipe) id: string): Promise<QcRunDetailDto> {
    return this.qc.getRun(id);
  }

  @Post('runs')
  @Roles(...rolesOf(ROLE_GROUPS.ANALYSIS))
  createRun(@Body(new ZodValidationPipe(qcRunSchema)) body: QcRunInput, @CurrentUser() actor: RequestUser): Promise<QcRunDetailDto> {
    return this.qc.createRun(body, actor);
  }

  @Post('runs/:id/corrective-action')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.QC_CORRECTIVE))
  corrective(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(qcCorrectiveActionSchema)) body: QcCorrectiveActionInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<QcRunDetailDto> {
    return this.qc.recordCorrectiveAction(id, body, actor);
  }

  @Post('runs/:id/exclude')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.QC_EXCLUDE))
  exclude(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(qcExcludeSchema)) body: QcExcludeInput, @CurrentUser() actor: RequestUser): Promise<QcRunDetailDto> {
    return this.qc.exclude(id, body, actor);
  }
}

@Controller('quality-issues')
export class QualityIssuesController {
  constructor(private readonly issues: QualityIssuesService) {}

  /** Tout le personnel peut consulter ses déclarations ; les rôles qualité voient l'ensemble. */
  @Get()
  @AnyRole()
  list(@Query(new ZodValidationPipe(qualityIssuesQuerySchema)) q: QualityIssuesQuery, @CurrentUser() actor: RequestUser): Promise<Paginated<QualityIssueDto>> {
    return this.issues.list(q, actor);
  }

  @Get(':id')
  @AnyRole()
  get(@Param('id', uuidPipe) id: string, @CurrentUser() actor: RequestUser): Promise<QualityIssueDto> {
    return this.issues.get(id, actor);
  }

  /** Déclaration ouverte à tout le personnel (ISO 15189 : chacun signale les non-conformités). */
  @Post()
  @AnyRole()
  create(@Body(new ZodValidationPipe(createQualityIssueSchema)) body: CreateQualityIssueInput, @CurrentUser() actor: RequestUser): Promise<QualityIssueDto> {
    return this.issues.create(body, actor);
  }

  @Post(':id/plan')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.QUALITY_MANAGE))
  plan(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(planQualityIssueSchema)) body: PlanQualityIssueInput, @CurrentUser() actor: RequestUser): Promise<QualityIssueDto> {
    return this.issues.plan(id, body, actor);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.QUALITY_CLOSE))
  close(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(closeQualityIssueSchema)) body: CloseQualityIssueInput, @CurrentUser() actor: RequestUser): Promise<QualityIssueDto> {
    return this.issues.close(id, body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.QUALITY_CLOSE))
  cancel(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(cancelQualityIssueSchema)) body: CancelQualityIssueInput, @CurrentUser() actor: RequestUser): Promise<QualityIssueDto> {
    return this.issues.cancel(id, body, actor);
  }
}

@Controller('quality/indicators')
export class IndicatorsController {
  constructor(private readonly indicators: IndicatorsService) {}

  @Get()
  @Roles(...rolesOf(ROLE_GROUPS.INDICATORS))
  get(@Query(new ZodValidationPipe(indicatorsQuerySchema)) q: IndicatorsQuery): Promise<IndicatorsDto> {
    return this.indicators.compute(q);
  }
}

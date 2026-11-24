import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  acknowledgeAlertSchema,
  biologicalValidationSchema,
  resultReasonSchema,
  saveResultsSchema,
  worklistQuerySchema,
  type AcknowledgeAlertInput,
  type AnalysisItemDto,
  type BiologicalValidationInput,
  type OrderResultsDto,
  type Paginated,
  type ReportDto,
  type ResultReasonInput,
  type SaveResultsInput,
  type WorklistItemDto,
  type WorklistQuery,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { ReportsService } from './reports.service';
import { ResultsService } from './results.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const ANALYSTS = rolesOf(ROLE_GROUPS.ANALYSIS);
const READ = rolesOf(ROLE_GROUPS.PATIENT_READ);

@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  /** Liste de travail (paillasse) par section et par étape. */
  @Get('worklist')
  @Roles(...ANALYSTS)
  worklist(@Query(new ZodValidationPipe(worklistQuerySchema)) query: WorklistQuery): Promise<Paginated<WorklistItemDto>> {
    return this.results.worklist(query);
  }

  @Get('orders/:orderId')
  @Roles(...READ)
  orderResults(@Param('orderId', uuidPipe) orderId: string): Promise<OrderResultsDto> {
    return this.results.getOrderResults(orderId);
  }

  @Put('items/:id')
  @Roles(...ANALYSTS)
  save(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(saveResultsSchema)) body: SaveResultsInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<AnalysisItemDto> {
    return this.results.save(id, body, actor);
  }

  @Post('items/:id/technical-validation')
  @HttpCode(HttpStatus.OK)
  @Roles(...ANALYSTS)
  technical(@Param('id', uuidPipe) id: string, @CurrentUser() actor: RequestUser): Promise<AnalysisItemDto> {
    return this.results.technicalValidate(id, actor);
  }

  @Post('items/:id/biological-validation')
  @HttpCode(HttpStatus.OK)
  @Roles('BIOLOGISTE')
  biological(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(biologicalValidationSchema)) body: BiologicalValidationInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<AnalysisItemDto> {
    return this.results.biologicalValidate(id, body, actor);
  }

  @Post('items/:id/return')
  @HttpCode(HttpStatus.OK)
  @Roles('BIOLOGISTE')
  returnToEntry(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(resultReasonSchema)) body: ResultReasonInput): Promise<AnalysisItemDto> {
    return this.results.returnToEntry(id, body);
  }

  @Post('items/:id/amend')
  @HttpCode(HttpStatus.OK)
  @Roles('BIOLOGISTE')
  amend(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(resultReasonSchema)) body: ResultReasonInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<AnalysisItemDto> {
    return this.results.amend(id, body, actor);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @Roles(...ANALYSTS)
  acknowledge(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(acknowledgeAlertSchema)) body: AcknowledgeAlertInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<AnalysisItemDto> {
    return this.results.acknowledgeAlert(id, body, actor);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('orders/:orderId')
  @Roles(...READ)
  list(@Param('orderId', uuidPipe) orderId: string): Promise<ReportDto[]> {
    return this.reports.list(orderId);
  }

  @Post('orders/:orderId/partial')
  @Roles('BIOLOGISTE')
  partial(@Param('orderId', uuidPipe) orderId: string, @CurrentUser() actor: RequestUser): Promise<ReportDto> {
    return this.reports.issuePartial(orderId, actor);
  }

  /** PDF archivé, servi à l'identique (l'empreinte SHA-256 est renvoyée en en-tête pour vérification). */
  @Get(':id/pdf')
  @Roles(...READ)
  async pdf(@Param('id', uuidPipe) id: string, @Res() res: Response): Promise<void> {
    const report = await this.reports.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${report.number}.pdf"`);
    res.setHeader('X-Content-SHA256', report.sha256);
    res.setHeader('Access-Control-Expose-Headers', 'X-Content-SHA256, X-Request-Id');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(report.pdf);
  }
}

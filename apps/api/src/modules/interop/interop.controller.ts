import type { Response } from 'express';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import {
  dhis2MappingSchema,
  dhis2PeriodQuerySchema,
  dhis2SendSchema,
  interopEndpointSchema,
  interopRunsQuerySchema,
  vlsmMappingSchema,
  vlsmPendingQuerySchema,
  vlsmSendSchema,
  type Dhis2MappingDto,
  type Dhis2MappingInput,
  type Dhis2PeriodQuery,
  type Dhis2PreviewDto,
  type Dhis2SendInput,
  type InteropEndpointDto,
  type InteropEndpointInput,
  type InteropOverviewDto,
  type InteropRunDetailDto,
  type InteropRunDto,
  type InteropRunsQuery,
  type Paginated,
  type VlsmMappingDto,
  type VlsmMappingInput,
  type VlsmPendingItemDto,
  type VlsmPendingQuery,
  type VlsmSendInput,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { Dhis2ExportService } from './dhis2-export.service';
import { InteropEndpointsService } from './endpoints.service';
import { InteropMappingsService } from './mappings.service';
import { InteropRunsService } from './runs.service';
import { VlsmExportService } from './vlsm-export.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const READ = rolesOf(ROLE_GROUPS.INTEROP_READ);
const CONFIG = rolesOf(ROLE_GROUPS.INTEROP_CONFIG);
const MAPPING = rolesOf(ROLE_GROUPS.INTEROP_MAPPING);
const SEND = rolesOf(ROLE_GROUPS.INTEROP_SEND);

@Controller('interop')
export class InteropController {
  constructor(
    private readonly endpoints: InteropEndpointsService,
    private readonly mappings: InteropMappingsService,
    private readonly dhis2: Dhis2ExportService,
    private readonly vlsm: VlsmExportService,
    private readonly runs: InteropRunsService,
  ) {}

  @Get('overview')
  @Roles(...READ)
  overview(): InteropOverviewDto {
    return this.endpoints.overview();
  }

  // --- Connexions --------------------------------------------------------------

  @Get('endpoints')
  @Roles(...READ)
  list(): Promise<InteropEndpointDto[]> {
    return this.endpoints.list();
  }

  @Get('endpoints/:id')
  @Roles(...READ)
  get(@Param('id', uuidPipe) id: string): Promise<InteropEndpointDto> {
    return this.endpoints.get(id);
  }

  @Post('endpoints')
  @Roles(...CONFIG)
  create(@Body(new ZodValidationPipe(interopEndpointSchema)) body: InteropEndpointInput): Promise<InteropEndpointDto> {
    return this.endpoints.create(body);
  }

  @Put('endpoints/:id')
  @Roles(...CONFIG)
  update(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(interopEndpointSchema)) body: InteropEndpointInput): Promise<InteropEndpointDto> {
    return this.endpoints.update(id, body);
  }

  @Post('endpoints/:id/test')
  @HttpCode(HttpStatus.OK)
  @Roles(...CONFIG)
  test(@Param('id', uuidPipe) id: string, @CurrentUser() user: RequestUser): Promise<InteropEndpointDto> {
    return this.endpoints.test(id, user.id);
  }

  // --- Correspondances DHIS2 ---------------------------------------------------

  @Get('endpoints/:id/dhis2-mappings')
  @Roles(...READ)
  listDhis2(@Param('id', uuidPipe) id: string): Promise<Dhis2MappingDto[]> {
    return this.mappings.listDhis2(id);
  }

  @Post('endpoints/:id/dhis2-mappings')
  @Roles(...MAPPING)
  createDhis2(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(dhis2MappingSchema)) body: Dhis2MappingInput): Promise<Dhis2MappingDto> {
    return this.mappings.createDhis2(id, body);
  }

  @Put('dhis2-mappings/:id')
  @Roles(...MAPPING)
  updateDhis2(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(dhis2MappingSchema)) body: Dhis2MappingInput): Promise<Dhis2MappingDto> {
    return this.mappings.updateDhis2(id, body);
  }

  @Delete('dhis2-mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...MAPPING)
  deleteDhis2(@Param('id', uuidPipe) id: string): Promise<void> {
    return this.mappings.deleteDhis2(id);
  }

  // --- Rapport DHIS2 -------------------------------------------------------------

  @Get('endpoints/:id/dhis2/preview')
  @Roles(...READ)
  preview(@Param('id', uuidPipe) id: string, @Query(new ZodValidationPipe(dhis2PeriodQuerySchema)) q: Dhis2PeriodQuery): Promise<Dhis2PreviewDto> {
    return this.dhis2.preview(id, q.period);
  }

  /** Fichier CSV au format d'import DHIS2, pour une saisie hors ligne (Import/Export). */
  @Get('endpoints/:id/dhis2/csv')
  @Roles(...READ)
  async csv(@Param('id', uuidPipe) id: string, @Query(new ZodValidationPipe(dhis2PeriodQuerySchema)) q: Dhis2PeriodQuery, @Res() res: Response): Promise<void> {
    const file = await this.dhis2.csv(id, q.period);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(file.content);
  }

  @Post('endpoints/:id/dhis2/send')
  @HttpCode(HttpStatus.OK)
  @Roles(...SEND)
  sendDhis2(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(dhis2SendSchema)) body: Dhis2SendInput, @CurrentUser() user: RequestUser): Promise<InteropRunDetailDto> {
    return this.dhis2.send(id, body, user.id);
  }

  // --- VLSM -------------------------------------------------------------------------

  @Get('endpoints/:id/vlsm-mappings')
  @Roles(...READ)
  listVlsm(@Param('id', uuidPipe) id: string): Promise<VlsmMappingDto[]> {
    return this.mappings.listVlsm(id);
  }

  @Post('endpoints/:id/vlsm-mappings')
  @Roles(...MAPPING)
  createVlsm(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(vlsmMappingSchema)) body: VlsmMappingInput): Promise<VlsmMappingDto> {
    return this.mappings.createVlsm(id, body);
  }

  @Put('vlsm-mappings/:id')
  @Roles(...MAPPING)
  updateVlsm(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(vlsmMappingSchema)) body: VlsmMappingInput): Promise<VlsmMappingDto> {
    return this.mappings.updateVlsm(id, body);
  }

  @Delete('vlsm-mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...MAPPING)
  deleteVlsm(@Param('id', uuidPipe) id: string): Promise<void> {
    return this.mappings.deleteVlsm(id);
  }

  @Get('endpoints/:id/vlsm/pending')
  @Roles(...READ)
  pending(@Param('id', uuidPipe) id: string, @Query(new ZodValidationPipe(vlsmPendingQuerySchema)) q: VlsmPendingQuery): Promise<VlsmPendingItemDto[]> {
    return this.vlsm.pending(id, q);
  }

  @Post('endpoints/:id/vlsm/send')
  @HttpCode(HttpStatus.OK)
  @Roles(...SEND)
  sendVlsm(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(vlsmSendSchema)) body: VlsmSendInput, @CurrentUser() user: RequestUser): Promise<InteropRunDetailDto> {
    return this.vlsm.send(id, body, user.id);
  }

  // --- Journal des échanges -----------------------------------------------------------

  @Get('runs')
  @Roles(...READ)
  listRuns(@Query(new ZodValidationPipe(interopRunsQuerySchema)) q: InteropRunsQuery): Promise<Paginated<InteropRunDto>> {
    return this.runs.list(q);
  }

  @Get('runs/:id')
  @Roles(...READ)
  getRun(@Param('id', uuidPipe) id: string): Promise<InteropRunDetailDto> {
    return this.runs.get(id);
  }
}

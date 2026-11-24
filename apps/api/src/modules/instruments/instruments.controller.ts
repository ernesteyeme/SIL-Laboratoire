import { z } from 'zod';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  dismissInstrumentResultSchema,
  gatewayMessageSchema,
  instrumentMappingSchema,
  instrumentMessagesQuerySchema,
  instrumentQcMaterialSchema,
  instrumentResultsQuerySchema,
  instrumentSchema,
  instrumentUploadSchema,
  INSTRUMENT_PROTOCOL_LABELS,
  type DismissInstrumentResultInput,
  type GatewayMessageInput,
  type IngestResultDto,
  type InstrumentApiKeyDto,
  type InstrumentDto,
  type InstrumentInput,
  type InstrumentMappingInput,
  type InstrumentMessageDetailDto,
  type InstrumentMessageDto,
  type InstrumentMessagesQuery,
  type InstrumentQcMaterialInput,
  type InstrumentResultDto,
  type InstrumentResultsQuery,
  type InstrumentUploadInput,
  type InstrumentWorklistDto,
  type Paginated,
} from '@lims/shared';
import type { Instrument } from '../../generated/prisma/client';
import type { RequestUser } from '../../core/context/request-context';
import { NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CurrentUser, Public, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { InstrumentIngestService } from './ingest.service';
import { CurrentInstrument, InstrumentKeyGuard } from './instrument-key.guard';
import { InstrumentsService } from './instruments.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const worklistQuerySchema = z.object({
  specimens: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v ? [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 100) : undefined)),
});
const READ = rolesOf(ROLE_GROUPS.INSTRUMENT_READ);
const CONFIG = rolesOf(ROLE_GROUPS.INSTRUMENT_CONFIG);
const OPERATE = rolesOf(ROLE_GROUPS.INSTRUMENT_OPERATE);

@Controller('instruments')
export class InstrumentsController {
  constructor(
    private readonly instruments: InstrumentsService,
    private readonly ingest: InstrumentIngestService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles(...READ)
  list(): Promise<InstrumentDto[]> {
    return this.instruments.list();
  }

  @Get(':id')
  @Roles(...READ)
  get(@Param('id', uuidPipe) id: string): Promise<InstrumentDto> {
    return this.instruments.get(id);
  }

  @Post()
  @Roles(...CONFIG)
  create(@Body(new ZodValidationPipe(instrumentSchema)) body: InstrumentInput): Promise<InstrumentDto> {
    return this.instruments.create(body);
  }

  @Put(':id')
  @Roles(...CONFIG)
  update(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(instrumentSchema)) body: InstrumentInput): Promise<InstrumentDto> {
    return this.instruments.update(id, body);
  }

  /** Clé du connecteur : affichée une seule fois, l'ancienne est révoquée. */
  @Post(':id/api-key')
  @Roles(...rolesOf(ROLE_GROUPS.INSTRUMENT_KEY))
  apiKey(@Param('id', uuidPipe) id: string): Promise<InstrumentApiKeyDto> {
    return this.instruments.rotateApiKey(id);
  }

  @Put(':id/mappings')
  @Roles(...CONFIG)
  mapping(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(instrumentMappingSchema)) body: InstrumentMappingInput): Promise<InstrumentDto> {
    return this.instruments.upsertMapping(id, body);
  }

  @Put(':id/qc-materials')
  @Roles(...CONFIG)
  qcMaterial(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(instrumentQcMaterialSchema)) body: InstrumentQcMaterialInput): Promise<InstrumentDto> {
    return this.instruments.upsertQcMaterial(id, body);
  }

  @Delete(':id/qc-materials/:linkId')
  @Roles(...CONFIG)
  removeQcMaterial(@Param('id', uuidPipe) id: string, @Param('linkId', uuidPipe) linkId: string): Promise<InstrumentDto> {
    return this.instruments.removeQcMaterial(id, linkId);
  }

  /** Import manuel d'un fichier exporté par l'automate (clé USB, dossier partagé…). */
  @Post(':id/upload')
  @Roles(...OPERATE)
  async upload(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(instrumentUploadSchema)) body: InstrumentUploadInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<IngestResultDto> {
    const instrument = await this.prisma.instrument.findUnique({ where: { id } });
    if (!instrument) throw new NotFoundError('Automate', id);
    return this.ingest.ingest(instrument, body.content, 'UPLOAD', actor, body.filename);
  }

  /** Liste de travail de l'automate (consultation au laboratoire). */
  @Get(':id/worklist')
  @Roles(...READ)
  async worklist(@Param('id', uuidPipe) id: string): Promise<InstrumentWorklistDto> {
    const instrument = await this.prisma.instrument.findUnique({ where: { id } });
    if (!instrument) throw new NotFoundError('Automate', id);
    return this.ingest.worklist(instrument);
  }
}

@Controller('instrument-messages')
export class InstrumentMessagesController {
  constructor(private readonly ingest: InstrumentIngestService) {}

  @Get()
  @Roles(...READ)
  list(@Query(new ZodValidationPipe(instrumentMessagesQuerySchema)) q: InstrumentMessagesQuery): Promise<Paginated<InstrumentMessageDto>> {
    return this.ingest.listMessages(q);
  }

  @Get(':id')
  @Roles(...READ)
  get(@Param('id', uuidPipe) id: string): Promise<InstrumentMessageDetailDto> {
    return this.ingest.getMessage(id);
  }
}

@Controller('instrument-results')
export class InstrumentResultsController {
  constructor(private readonly ingest: InstrumentIngestService) {}

  @Get()
  @Roles(...READ)
  list(@Query(new ZodValidationPipe(instrumentResultsQuerySchema)) q: InstrumentResultsQuery): Promise<Paginated<InstrumentResultDto>> {
    return this.ingest.listResults(q);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @Roles(...OPERATE)
  retry(@Param('id', uuidPipe) id: string, @CurrentUser() actor: RequestUser): Promise<InstrumentResultDto> {
    return this.ingest.retry(id, actor);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @Roles(...OPERATE)
  accept(@Param('id', uuidPipe) id: string, @CurrentUser() actor: RequestUser): Promise<InstrumentResultDto> {
    return this.ingest.accept(id, actor);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @Roles(...OPERATE)
  dismiss(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(dismissInstrumentResultSchema)) body: DismissInstrumentResultInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<InstrumentResultDto> {
    return this.ingest.dismiss(id, body.reason, actor);
  }
}

/**
 * Points d'entrée des connecteurs de poste : authentification par clé d'automate, pas par session utilisateur.
 * (@Public désactive les guards JWT et rôles ; InstrumentKeyGuard prend le relais.)
 */
@Controller('instrument-gateway')
@Public()
@UseGuards(InstrumentKeyGuard)
export class InstrumentGatewayController {
  constructor(private readonly ingest: InstrumentIngestService) {}

  /** Vérification de configuration du connecteur. */
  @Get('ping')
  ping(@CurrentInstrument() instrument: Instrument) {
    return { instrument: { code: instrument.code, name: instrument.name, protocol: instrument.protocol, protocolLabel: INSTRUMENT_PROTOCOL_LABELS[instrument.protocol] }, serverTime: new Date().toISOString() };
  }

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  message(
    @CurrentInstrument() instrument: Instrument,
    @Body(new ZodValidationPipe(gatewayMessageSchema)) body: GatewayMessageInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<IngestResultDto> {
    return this.ingest.ingest(instrument, body.message, 'GATEWAY', actor);
  }

  /** Liste de travail ; « ?specimens=a,b » restreint aux tubes demandés par l'automate (requête hôte ASTM Q). */
  @Get('worklist')
  worklist(@CurrentInstrument() instrument: Instrument, @Query(new ZodValidationPipe(worklistQuerySchema)) q: z.infer<typeof worklistQuerySchema>): Promise<InstrumentWorklistDto> {
    return this.ingest.worklist(instrument, q.specimens);
  }
}

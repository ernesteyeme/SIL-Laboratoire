import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createLabSectionSchema,
  createSampleTypeSchema,
  updateLabSectionSchema,
  updateSampleTypeSchema,
  type CreateLabSectionInput,
  type CreateSampleTypeInput,
  type LabSectionDto,
  type SampleTypeDto,
  type UpdateLabSectionInput,
  type UpdateSampleTypeInput,
} from '@lims/shared';
import { AnyRole, Roles } from '../../core/security/decorators';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { CatalogStructureService } from './catalog-structure.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@Controller('catalog/sections')
export class LabSectionsController {
  constructor(private readonly service: CatalogStructureService) {}

  @Get()
  @AnyRole()
  list(): Promise<LabSectionDto[]> {
    return this.service.listSections();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body(new ZodValidationPipe(createLabSectionSchema)) body: CreateLabSectionInput): Promise<LabSectionDto> {
    return this.service.createSection(body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateLabSectionSchema)) body: UpdateLabSectionInput,
  ): Promise<LabSectionDto> {
    return this.service.updateSection(id, body);
  }
}

@Controller('catalog/sample-types')
export class SampleTypesController {
  constructor(private readonly service: CatalogStructureService) {}

  @Get()
  @AnyRole()
  list(): Promise<SampleTypeDto[]> {
    return this.service.listSampleTypes();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body(new ZodValidationPipe(createSampleTypeSchema)) body: CreateSampleTypeInput): Promise<SampleTypeDto> {
    return this.service.createSampleType(body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateSampleTypeSchema)) body: UpdateSampleTypeInput,
  ): Promise<SampleTypeDto> {
    return this.service.updateSampleType(id, body);
  }
}

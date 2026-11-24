import { Module } from '@nestjs/common';
import { LabSectionsController, SampleTypesController } from './catalog-structure.controller';
import { CatalogStructureService } from './catalog-structure.service';
import { CatalogRepository } from './catalog.repository';
import { ExamsController, ParametersController } from './exams.controller';
import { ExamsService } from './exams.service';
import { ParametersService } from './parameters.service';

@Module({
  controllers: [LabSectionsController, SampleTypesController, ExamsController, ParametersController],
  providers: [CatalogRepository, CatalogStructureService, ExamsService, ParametersService],
  exports: [CatalogRepository],
})
export class CatalogModule {}

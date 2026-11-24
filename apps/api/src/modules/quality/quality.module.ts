import { Module } from '@nestjs/common';
import { IndicatorsRepository } from './indicators.repository';
import { IndicatorsService } from './indicators.service';
import { QcRepository } from './qc.repository';
import { QcService } from './qc.service';
import { IndicatorsController, QcController, QualityIssuesController } from './quality.controller';
import { QualityIssuesRepository } from './quality-issues.repository';
import { QualityIssuesService } from './quality-issues.service';

@Module({
  controllers: [QcController, QualityIssuesController, IndicatorsController],
  providers: [QcRepository, QcService, QualityIssuesRepository, QualityIssuesService, IndicatorsRepository, IndicatorsService],
  exports: [QcService],
})
export class QualityModule {}

import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { QualityModule } from '../quality/quality.module';
import { OrdersController, SamplesController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { SamplesService } from './samples.service';
import { ReportsController, ResultsController } from '../results/results.controller';
import { ResultsRepository } from '../results/results.repository';
import { ReportsService } from '../results/reports.service';
import { ResultsService } from '../results/results.service';

@Module({
  imports: [BillingModule, QualityModule],
  controllers: [OrdersController, SamplesController, ResultsController, ReportsController],
  providers: [OrdersRepository, OrdersService, SamplesService, ResultsRepository, ResultsService, ReportsService],
  exports: [OrdersRepository, ResultsService],
})
export class OrdersModule {}

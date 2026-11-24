import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { QualityModule } from '../quality/quality.module';
import { InstrumentIngestService } from './ingest.service';
import { InstrumentKeyGuard } from './instrument-key.guard';
import { InstrumentGatewayController, InstrumentMessagesController, InstrumentResultsController, InstrumentsController } from './instruments.controller';
import { InstrumentsRepository } from './instruments.repository';
import { InstrumentsService } from './instruments.service';

@Module({
  imports: [OrdersModule, QualityModule],
  controllers: [InstrumentsController, InstrumentMessagesController, InstrumentResultsController, InstrumentGatewayController],
  providers: [InstrumentsRepository, InstrumentsService, InstrumentIngestService, InstrumentKeyGuard],
})
export class InstrumentsModule {}

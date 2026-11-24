import { Module } from '@nestjs/common';
import { CashSessionsController, ExchangeRatesController, InvoicesController, PaymentsController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { CashSessionsService } from './cash-sessions.service';
import { ExchangeRatesService } from './exchange-rates.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [InvoicesController, PaymentsController, CashSessionsController, ExchangeRatesController],
  providers: [BillingRepository, InvoicesService, PaymentsService, CashSessionsService, ExchangeRatesService],
  exports: [InvoicesService, ExchangeRatesService],
})
export class BillingModule {}

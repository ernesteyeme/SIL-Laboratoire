import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  cancelPaymentSchema,
  closeCashSessionSchema,
  discountSchema,
  exchangeRateSchema,
  listCashSessionsQuerySchema,
  listInvoicesQuerySchema,
  openCashSessionSchema,
  paymentSchema,
  type CancelPaymentInput,
  type CashSessionDto,
  type CashSessionReportDto,
  type CloseCashSessionInput,
  type DiscountInput,
  type ExchangeRateDto,
  type ExchangeRateInput,
  type InvoiceDetailDto,
  type InvoiceListItemDto,
  type ListCashSessionsQuery,
  type ListInvoicesQuery,
  type OpenCashSessionInput,
  type Paginated,
  type PaymentInput,
  type ReceiptDto,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { AnyRole, CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { CashSessionsService } from './cash-sessions.service';
import { ExchangeRatesService } from './exchange-rates.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const READ = rolesOf(ROLE_GROUPS.BILLING_READ);
const CASHIER = rolesOf(ROLE_GROUPS.CASHIER);

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @Roles(...READ)
  list(@Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery): Promise<Paginated<InvoiceListItemDto>> {
    return this.invoices.list(query);
  }

  @Get(':id')
  @Roles(...READ)
  get(@Param('id', uuidPipe) id: string): Promise<InvoiceDetailDto> {
    return this.invoices.get(id);
  }

  @Post(':id/discount')
  @HttpCode(HttpStatus.OK)
  @Roles(...CASHIER)
  discount(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(discountSchema)) body: DiscountInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.applyDiscount(id, body, actor);
  }

  @Post(':id/payments')
  @Roles(...CASHIER)
  pay(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(paymentSchema)) body: PaymentInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<{ invoice: InvoiceDetailDto; paymentId: string }> {
    return this.payments.pay(id, body, actor);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id/receipt')
  @Roles(...READ)
  receipt(@Param('id', uuidPipe) id: string): Promise<ReceiptDto> {
    return this.payments.receipt(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  cancel(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(cancelPaymentSchema)) body: CancelPaymentInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<InvoiceDetailDto> {
    return this.payments.cancel(id, body, actor);
  }
}

@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Get()
  @Roles(...READ)
  list(): Promise<ExchangeRateDto[]> {
    return this.rates.list();
  }

  /** Taux du jour : consultable par tous (affichage des équivalents). */
  @Get('today')
  @AnyRole()
  today(): Promise<ExchangeRateDto | null> {
    return this.rates.getToday();
  }

  /** Saisie du taux du jour : administration et comptabilité (séparation des tâches avec la caisse). */
  @Put('today')
  @Roles(...rolesOf(ROLE_GROUPS.EXCHANGE_RATE_WRITE))
  setToday(@Body(new ZodValidationPipe(exchangeRateSchema)) body: ExchangeRateInput, @CurrentUser() actor: RequestUser): Promise<ExchangeRateDto> {
    return this.rates.setToday(body, actor);
  }
}

@Controller('cash-sessions')
export class CashSessionsController {
  constructor(private readonly sessions: CashSessionsService) {}

  @Get()
  @Roles(...READ)
  list(
    @Query(new ZodValidationPipe(listCashSessionsQuerySchema)) query: ListCashSessionsQuery,
    @CurrentUser() actor: RequestUser,
  ): Promise<Paginated<CashSessionDto>> {
    return this.sessions.list(query, actor);
  }

  @Get('current')
  @Roles(...CASHIER)
  current(@CurrentUser() actor: RequestUser): Promise<CashSessionDto | null> {
    return this.sessions.current(actor);
  }

  @Post('open')
  @Roles(...CASHIER)
  open(
    @Body(new ZodValidationPipe(openCashSessionSchema)) body: OpenCashSessionInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<CashSessionDto> {
    return this.sessions.open(body, actor);
  }

  @Post('current/close')
  @HttpCode(HttpStatus.OK)
  @Roles(...CASHIER)
  close(
    @Body(new ZodValidationPipe(closeCashSessionSchema)) body: CloseCashSessionInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<CashSessionDto> {
    return this.sessions.close(body, actor);
  }

  @Get(':id')
  @Roles(...READ)
  report(@Param('id', uuidPipe) id: string, @CurrentUser() actor: RequestUser): Promise<CashSessionReportDto> {
    return this.sessions.report(id, actor);
  }
}

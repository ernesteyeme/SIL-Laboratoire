import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  cancelOrderSchema,
  collectSampleSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  listSamplesQuerySchema,
  nonConformitySchema,
  recollectSchema,
  type CancelOrderInput,
  type CollectSampleInput,
  type CreateOrderInput,
  type ListOrdersQuery,
  type ListSamplesQuery,
  type NonConformityInput,
  type OrderDetailDto,
  type OrderListItemDto,
  type Paginated,
  type RecollectInput,
  type SampleContextDto,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { CurrentUser, Roles } from '../../core/security/decorators';
import { ROLE_GROUPS, rolesOf } from '../../core/security/role-groups';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { OrdersService } from './orders.service';
import { SamplesService } from './samples.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  list(@Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery): Promise<Paginated<OrderListItemDto>> {
    return this.orders.list(query);
  }

  @Get(':id')
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  get(@Param('id', uuidPipe) id: string): Promise<OrderDetailDto> {
    return this.orders.get(id);
  }

  @Post()
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<OrderDetailDto> {
    return this.orders.create(body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.REGISTRATION_WRITE))
  cancel(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<OrderDetailDto> {
    return this.orders.cancel(id, body, actor);
  }
}

@Controller('samples')
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get()
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  list(@Query(new ZodValidationPipe(listSamplesQuerySchema)) query: ListSamplesQuery): Promise<Paginated<SampleContextDto>> {
    return this.samples.list(query);
  }

  /** Lecture d'un code-barres. */
  @Get('by-number/:number')
  @Roles(...rolesOf(ROLE_GROUPS.PATIENT_READ))
  byNumber(@Param('number') number: string): Promise<SampleContextDto> {
    return this.samples.getByNumber(number);
  }

  @Post(':id/collect')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.SAMPLE_COLLECT))
  collect(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(collectSampleSchema)) body: CollectSampleInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<SampleContextDto> {
    return this.samples.collect(id, body, actor);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @Roles(...rolesOf(ROLE_GROUPS.SAMPLE_RECEIVE))
  receive(@Param('id', uuidPipe) id: string, @CurrentUser() actor: RequestUser): Promise<SampleContextDto> {
    return this.samples.receive(id, actor);
  }

  @Post(':id/non-conformities')
  @Roles(...rolesOf(ROLE_GROUPS.SAMPLE_RECEIVE))
  nonConformity(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(nonConformitySchema)) body: NonConformityInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<SampleContextDto> {
    return this.samples.recordNonConformity(id, body, actor);
  }

  @Post(':id/recollect')
  @Roles(...rolesOf(ROLE_GROUPS.SAMPLE_RECOLLECT))
  recollect(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(recollectSchema)) body: RecollectInput,
  ): Promise<SampleContextDto> {
    return this.samples.recollect(id, body);
  }
}

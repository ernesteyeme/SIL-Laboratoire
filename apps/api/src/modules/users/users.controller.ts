import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  userStatusChangeSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type Paginated,
  type ResetPasswordInput,
  type UpdateUserInput,
  type UserDto,
  type UserStatusChangeInput,
} from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { CurrentUser, Roles } from '../../core/security/decorators';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UsersService } from './users.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery): Promise<Paginated<UserDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id', uuidPipe) id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<UserDto> {
    return this.users.create(body, actor);
  }

  @Patch(':id')
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<UserDto> {
    return this.users.update(id, body, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<UserDto> {
    return this.users.resetPassword(id, body, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(userStatusChangeSchema)) body: UserStatusChangeInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<UserDto> {
    return this.users.deactivate(id, body, actor);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(userStatusChangeSchema)) body: UserStatusChangeInput,
  ): Promise<UserDto> {
    return this.users.reactivate(id, body);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(userStatusChangeSchema)) body: UserStatusChangeInput,
  ): Promise<UserDto> {
    return this.users.unlock(id, body);
  }
}

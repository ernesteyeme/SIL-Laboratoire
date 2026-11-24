import { Body, Controller, Get, Put } from '@nestjs/common';
import { labSettingsSchema, type LabSettingsDto, type LabSettingsInput } from '@lims/shared';
import type { RequestUser } from '../../core/context/request-context';
import { AnyRole, CurrentUser, Roles } from '../../core/security/decorators';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { SettingsService } from './settings.service';

@Controller('settings/lab')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @AnyRole()
  get(): Promise<LabSettingsDto> {
    return this.settings.get();
  }

  @Put()
  @Roles('ADMIN')
  update(
    @Body(new ZodValidationPipe(labSettingsSchema)) body: LabSettingsInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<LabSettingsDto> {
    return this.settings.update(body, actor);
  }
}

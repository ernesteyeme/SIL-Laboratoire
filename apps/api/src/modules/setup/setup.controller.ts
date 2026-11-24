import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  setupCompleteSchema,
  setupTokenCheckSchema,
  type SetupCompleteInput,
  type SetupResultDto,
  type SetupStatusDto,
  type SetupTokenCheckInput,
  type VersionDto,
} from '@lims/shared';
import { APP_INFO } from '../../core/common/app-info';
import { Public } from '../../core/security/decorators';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { SetupService } from './setup.service';

/**
 * Assistant du premier démarrage. Routes publiques, mais inopérantes dès qu'un compte existe,
 * et l'écriture exige le code d'installation généré par l'installateur.
 */
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get('status')
  status(): Promise<SetupStatusDto> {
    return this.setup.status();
  }

  @Public()
  @Get('version')
  version(): VersionDto {
    return APP_INFO;
  }

  @Public()
  @Post('verify-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body(new ZodValidationPipe(setupTokenCheckSchema)) body: SetupTokenCheckInput): Promise<void> {
    return this.setup.verifyToken(body.token);
  }

  @Public()
  @Post('complete')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  complete(@Body(new ZodValidationPipe(setupCompleteSchema)) body: SetupCompleteInput): Promise<SetupResultDto> {
    return this.setup.complete(body);
  }
}

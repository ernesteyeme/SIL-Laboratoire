import { Controller, Get, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ERROR_CODES } from '@lims/shared';
import { DomainException } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Public } from '../../core/security/decorators';
import { APP_INFO } from '../../core/common/app-info';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up'; time: string; version: string; commit: string | null }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new DomainException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.INTERNAL_ERROR,
        'Base de données indisponible.',
      );
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString(), version: APP_INFO.version, commit: APP_INFO.commit };
  }
}

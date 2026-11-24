import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { SetupRepository } from './setup.repository';
import { SetupService } from './setup.service';

/** Premier démarrage : paramètres du laboratoire, premier administrateur, catalogue de démarrage. */
@Module({
  controllers: [SetupController],
  providers: [SetupRepository, SetupService],
})
export class SetupModule {}

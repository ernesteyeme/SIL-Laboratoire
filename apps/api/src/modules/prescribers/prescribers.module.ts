import { Module } from '@nestjs/common';
import { PrescribersController } from './prescribers.controller';
import { PrescribersRepository } from './prescribers.repository';
import { PrescribersService } from './prescribers.service';

@Module({
  controllers: [PrescribersController],
  providers: [PrescribersRepository, PrescribersService],
  exports: [PrescribersRepository],
})
export class PrescribersModule {}

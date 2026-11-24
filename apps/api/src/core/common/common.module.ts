import { Global, Module } from '@nestjs/common';
import { NumberingService } from '../numbering/numbering.service';
import { LabContextService } from './lab-context.service';

@Global()
@Module({
  providers: [NumberingService, LabContextService],
  exports: [NumberingService, LabContextService],
})
export class CommonModule {}

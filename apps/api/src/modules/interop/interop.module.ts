import { Module } from '@nestjs/common';
import { Dhis2ExportService } from './dhis2-export.service';
import { InteropEndpointsService } from './endpoints.service';
import { Dhis2Gateway, VlsmGateway } from './gateways';
import { InteropController } from './interop.controller';
import { InteropHttpClient } from './interop-http';
import { InteropRepository } from './interop.repository';
import { InteropMappingsService } from './mappings.service';
import { InteropRunsService } from './runs.service';
import { SecretBox } from './secret-box';
import { VlsmExportService } from './vlsm-export.service';

/** Étape 7 — échanges avec DHIS2 (agrégats), VLSM/InteLIS (résultats CV et EID), directement ou via OpenHIM. */
@Module({
  controllers: [InteropController],
  providers: [
    InteropRepository,
    SecretBox,
    InteropHttpClient,
    Dhis2Gateway,
    VlsmGateway,
    InteropRunsService,
    InteropEndpointsService,
    InteropMappingsService,
    Dhis2ExportService,
    VlsmExportService,
  ],
})
export class InteropModule {}

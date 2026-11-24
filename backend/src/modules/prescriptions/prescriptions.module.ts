import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { PrescriptionRepositoryPrisma } from './infra/prescription.repository.prisma';
import { PRESCRIPTION_REPOSITORY } from './application/prescription.repository.port';
import { PrescriptionService } from './application/prescription.service';
import { PrescriptionController } from './api/prescription.controller';

/**
 * Prescriptions bounded context (P8).
 *
 * The server-side gate that blocks ordering scheduled (H/H1/X) medicines
 * without a verified, in-date prescription lives in `OrderService.place`,
 * which calls `PrescriptionService.assertUsableForOrder`. This module owns
 * the upload + verification workflow and the prescription store.
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [PrescriptionController],
  providers: [
    PrescriptionService,
    { provide: PRESCRIPTION_REPOSITORY, useClass: PrescriptionRepositoryPrisma },
  ],
  exports: [PrescriptionService],
})
export class PrescriptionsModule {}

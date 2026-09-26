import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PricingService } from './application/pricing.service';
import { PRICING_REPOSITORY } from './application/pricing.repository.port';
import { PrismaPricingRepository } from './infra/pricing.repository.prisma';

/**
 * Pricing bounded context.
 *
 * P2 ships the persistence layer: the `PricingRepository` port (declared in
 * `application/`) bound to its Prisma adapter (in `infra/`), and the
 * `PricingService` that resolves overrides and feeds them to the pure engine.
 * The HTTP surface (admin price-list management, the cart/order hooks) arrives
 * in later tasks; for now the service is exported for those to consume.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PricingService,
    { provide: PRICING_REPOSITORY, useClass: PrismaPricingRepository },
  ],
  exports: [PricingService],
})
export class PricingModule {}

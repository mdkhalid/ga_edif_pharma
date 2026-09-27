import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PricingService } from './application/pricing.service';
import { PRICING_REPOSITORY } from './application/pricing.repository.port';
import { SCHEME_REPOSITORY } from './application/scheme.repository.port';
import { PrismaPricingRepository } from './infra/pricing.repository.prisma';
import { PrismaSchemeRepository } from './infra/scheme.repository.prisma';

/**
 * Pricing bounded context.
 *
 * P2 ships the price-list persistence (`PricingRepository` port + Prisma adapter);
 * P3 adds scheme persistence (`SchemeRepository` port + Prisma adapter). Both are
 * bound here and consumed by `PricingService`, which resolves overrides and
 * schemes and feeds them to the pure engine. The HTTP surface (admin price-list
 * and scheme management, the cart/order hooks) arrives in later tasks; for now the
 * service is exported for those to consume.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PricingService,
    { provide: PRICING_REPOSITORY, useClass: PrismaPricingRepository },
    { provide: SCHEME_REPOSITORY, useClass: PrismaSchemeRepository },
  ],
  exports: [PricingService],
})
export class PricingModule {}

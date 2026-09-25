import { Module } from '@nestjs/common';

/**
 * Pricing module. Phase 2 (P1) ships the pure pricing/scheme engine in
 * `domain/`; the application port + Prisma repository (P2) and HTTP surface are
 * added later. Nothing is registered in the app module yet — the engine is
 * consumed directly by the cart/orders pricing steps until then.
 */
@Module({})
export class PricingModule {}

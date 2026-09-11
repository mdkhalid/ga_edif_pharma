import { Global, Module } from '@nestjs/common';

import {
  PrismaService,
  PRISMA_EXTENDED,
  extendPrismaClient,
  type ExtendedPrismaClient,
} from './prisma.service';
import { UnitOfWork } from './unit-of-work';

/**
 * Database module.
 *
 * `@Global()` because almost every feature module needs the database, and
 * importing this in twenty modules would add twenty chances to forget it. The
 * trade-off — a global is harder to trace than an explicit import — is
 * acceptable for infrastructure that is genuinely universal and has no
 * configuration to vary between consumers.
 *
 * ## Why the extended client is a separate provider
 *
 * `PrismaService` owns the connection lifecycle and is a plain `PrismaClient`.
 * `PRISMA_EXTENDED` is that client wrapped in the tenant-scoping extension, and
 * it is what application code injects.
 *
 * Splitting them means:
 *
 *   - the extension is applied once, at construction, so a service cannot
 *     accidentally inject the unextended client and query without scoping;
 *   - the health check and the seed scripts can reach the base client, which is
 *     the intended way to run an unscoped query without disabling the extension;
 *   - the dependency is explicit at every injection site: seeing
 *     `@Inject(PRISMA_EXTENDED)` in a constructor is a visible statement that
 *     this service touches tenant data.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: PRISMA_EXTENDED,
      useFactory: (base: PrismaService): ExtendedPrismaClient => extendPrismaClient(base),
      inject: [PrismaService],
    },
    UnitOfWork,
  ],
  exports: [PrismaService, PRISMA_EXTENDED, UnitOfWork],
})
export class DatabaseModule {}

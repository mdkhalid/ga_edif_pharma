import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { OnboardingController } from './api/onboarding.controller';
import { OnboardingService } from './application/onboarding.service';

/**
 * Onboarding and KYC bounded context.
 *
 * Depends on DatabaseModule for UnitOfWork and on AuditModule for the
 * append-only trail. Reached through `./index`, never by deep import.
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}

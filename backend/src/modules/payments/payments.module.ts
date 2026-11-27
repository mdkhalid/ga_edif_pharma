import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { PaymentController } from './api/payment.controller';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './application/payment-gateway.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from './application/payment.repository.port';
import { PaymentService } from './application/payment.service';
import { MockPaymentGateway } from './infra/payment-gateways/mock-gateway';
import { PaymentRepositoryPrisma } from './infra/payment.repository.prisma';

/**
 * Payments bounded context (P6 / A11).
 *
 * Only the configured gateway adapter is bound. The webhook translator accepts
 * a provider header but rejects any provider other than the one bound here —
 * an unconfigured gateway must not be able to move money.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, AuditModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    { provide: PAYMENT_REPOSITORY, useClass: PaymentRepositoryPrisma },
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
  ],
  exports: [PaymentService],
})
export class PaymentsModule {}

// Re-exported for tests that build the adapter without the module graph.
export { MockPaymentGateway, type PaymentGateway, type PaymentRepository };

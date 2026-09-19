import type { NotificationPort } from '../../src/common/ports/notification.port';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { UnitOfWork } from '../../src/database/unit-of-work';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import { NotificationService } from '../../src/modules/notifications/application/notification.service';
import { OrderService } from '../../src/modules/orders/application/order.service';

/**
 * Builds application services against a real database, outside Nest.
 *
 * The services take their collaborators through constructor injection, so they
 * can be assembled by hand. Doing that keeps these suites on the behaviour under
 * test — locking, the state machine, the history rows — instead of booting the
 * whole application graph, its guards and its HTTP layer, none of which is what
 * is being verified. The end-to-end HTTP path is the e2e suite's job.
 */

/** A notification port that sends nothing. Delivery is not under test here. */
export const SILENT_NOTIFICATION_PORT: NotificationPort = {
  sendOtp: () => Promise.resolve(),
  sendOrderPlaced: () => Promise.resolve(),
};

export function buildOrderService(prisma: ExtendedPrismaClient): OrderService {
  return new OrderService(
    prisma,
    new UnitOfWork(prisma),
    new AuditService(prisma),
    new NotificationService(SILENT_NOTIFICATION_PORT),
  );
}

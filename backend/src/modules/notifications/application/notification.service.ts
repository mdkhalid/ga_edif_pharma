import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../../../common/ports/notification.port';
import { renderOrderPlaced } from '../domain/order-templates';

/**
 * Application-level notifications.
 *
 * Renders templates and hands them to the bound `NotificationPort`. Every
 * method is best-effort: it catches transport failures and logs them, so a
 * notification can delay but never fail the business operation that caused
 * it. Durable delivery with retry (outbox relay) is the follow-up; this is
 * the seam it plugs into.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@Inject(NOTIFICATION_PORT) private readonly port: NotificationPort) {}

  async sendOrderPlaced(input: {
    orderId: string;
    total: string;
    currency: string;
    itemCount: number;
    tenantName: string;
    email: string | null;
    phone: string | null;
  }): Promise<void> {
    const template = renderOrderPlaced(input);
    try {
      await this.port.sendOrderPlaced({
        orderId: input.orderId,
        total: input.total,
        currency: input.currency,
        itemCount: input.itemCount,
        emailSubject: template.emailSubject,
        emailBody: template.emailBody,
        smsBody: template.smsBody,
        email: input.email,
        phone: input.phone,
      });
    } catch (error) {
      this.logger.warn(
        `Order-placed notice for order ${input.orderId} failed and will not be retried yet: ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

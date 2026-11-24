import { Inject, Injectable } from '@nestjs/common';

import {
  PUSH_TRANSPORT,
  type PushTransport,
} from '../../../common/ports/push.port';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';

export interface RegisterPushTokenDto {
  token: string;
  platform: 'ios' | 'android' | 'web';
  provider?: string;
}

/**
 * Push token registry (P9).
 *
 * Stores the device tokens a client registers so the push transport can reach
 * that user's devices. Registration is idempotent on `(userId, token)`: a client
 * that re-registers after a restart updates the stored platform/provider rather
 * than accumulating duplicate rows, which is what would otherwise cause the same
 * notification to arrive twice.
 *
 * Tokens are opaque here — the transport decides what they mean. Only the
 * `provider` label is persisted alongside them, so a token minted for a
 * different provider can be filtered later instead of being sent to the wrong
 * gateway.
 */
@Injectable()
export class PushTokenService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    @Inject(PUSH_TRANSPORT) private readonly push: PushTransport,
  ) {}

  async register(
    tenantId: string,
    userId: string,
    dto: RegisterPushTokenDto,
  ): Promise<{ id: string }> {
    // The tenant filter is applied by the scoping extension; `userId` is the
    // business key here.
    const existing = await this.prisma.pushToken.findFirst({ where: { userId, token: dto.token } });
    if (existing) {
      await this.prisma.pushToken.updateMany({
        where: { userId, token: dto.token },
        data: { platform: dto.platform, provider: dto.provider ?? 'console' },
      });
      return { id: existing.id };
    }

    const created = await this.prisma.pushToken.create({
      data: {
        tenantId,
        userId,
        token: dto.token,
        platform: dto.platform,
        provider: dto.provider ?? 'console',
      },
      select: { id: true },
    });
    return { id: created.id };
  }

  /** Remove a token, e.g. after the provider reports it as unregistered. */
  async unregister(_tenantId: string, userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  async listTokens(_tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    return rows.map((row) => row.token);
  }

  /**
   * Fan a notification out to every device registered by the user.
   *
   * Failures are isolated per token: one dead device must not stop delivery to
   * the others. The transport owns the "what went wrong" logging.
   */
  async sendToUser(
    tenantId: string,
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ delivered: number; failed: number }> {
    const tokens = await this.listTokens(tenantId, userId);
    const results = await Promise.allSettled(
      tokens.map((token) => this.push.send({ token, title, body, data })),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    return { delivered: results.length - failed, failed };
  }
}

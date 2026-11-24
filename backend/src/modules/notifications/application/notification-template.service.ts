import { Inject, Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';

/**
 * Notification templates (P9). A template is a named message with `{{var}}`
 * placeholders; `render` substitutes variables from a context object.
 */
@Injectable()
export class NotificationTemplateService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async create(tenantId: string | null, name: string, channel: string, subject: string | null, body: string): Promise<{ id: string }> {
    const row = await this.prisma.notificationTemplate.create({
      data: { tenantId, name, channel, subject, body },
      select: { id: true },
    });
    return { id: row.id };
  }

  async get(_tenantId: string | null, name: string, channel: string): Promise<{ subject: string | null; body: string } | null> {
    const row = await this.prisma.notificationTemplate.findFirst({ where: { name, channel } });
    if (!row) return null;
    return { subject: row.subject, body: row.body };
  }

  render(template: { subject: string | null; body: string }, context: Record<string, unknown>): { subject: string | null; body: string } {
    const replace = (s: string): string =>
      s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
        const v = context[key];
        return v === undefined || v === null ? '' : String(v);
      });
    return {
      subject: template.subject ? replace(template.subject) : null,
      body: replace(template.body),
    };
  }

  async renderByName(tenantId: string | null, name: string, channel: string, context: Record<string, unknown>): Promise<{ subject: string | null; body: string } | null> {
    const template = await this.get(tenantId, name, channel);
    if (!template) return null;
    return this.render(template, context);
  }
}

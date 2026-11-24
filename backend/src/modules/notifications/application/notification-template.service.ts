import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { AuditService } from '../../audit';

export interface NotificationTemplateRow {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertTemplateInput {
  name: string;
  channel: string;
  subject?: string | null;
  body: string;
}

/**
 * Notification templates (P9).
 *
 * A template is a named message with `{{var}}` placeholders; `render`
 * substitutes variables from a context object. Templates are tenant-scoped by
 * the scoping extension, so two tenants may use the same name for different
 * wording without colliding.
 *
 * Rendering is deliberately not a template language: `{{name}}` is substituted
 * and nothing else is evaluated. A message body is data that non-engineers edit,
 * so a richer syntax would turn a CMS field into an execution surface.
 */
@Injectable()
export class NotificationTemplateService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string | null,
    name: string,
    channel: string,
    subject: string | null,
    body: string,
  ): Promise<{ id: string }> {
    const row = await this.prisma.notificationTemplate.create({
      data: { tenantId, name, channel, subject, body },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** List the templates visible to a tenant, newest wording last but stable by name. */
  async list(_tenantId: string | null): Promise<NotificationTemplateRow[]> {
    const rows = await this.prisma.notificationTemplate.findMany({
      orderBy: [{ name: 'asc' }, { channel: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async get(_tenantId: string | null, name: string, channel: string): Promise<{ subject: string | null; body: string } | null> {
    const row = await this.prisma.notificationTemplate.findFirst({ where: { name, channel } });
    if (!row) return null;
    return { subject: row.subject, body: row.body };
  }

  /**
   * Create the template, or replace the wording of the one with the same
   * name+channel. Editing is an upsert because "the order-placed email" is
   * identified by what it is, not by a row id an admin had to remember.
   */
  async upsert(
    tenantId: string,
    actorId: string,
    input: UpsertTemplateInput,
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { name: input.name, channel: input.channel },
      select: { id: true, subject: true, body: true },
    });

    if (existing) {
      await this.prisma.notificationTemplate.updateMany({
        where: { id: existing.id },
        data: { subject: input.subject ?? null, body: input.body },
      });
      await this.audit.record({
        tenantId,
        action: 'notification.template.updated',
        entity: 'NotificationTemplate',
        entityId: existing.id,
        actorId,
        changes: {
          subject: { from: existing.subject, to: input.subject ?? null },
          body: { from: existing.body, to: input.body },
        },
      });
      return { id: existing.id, created: false };
    }

    const created = await this.create(tenantId, input.name, input.channel, input.subject ?? null, input.body);
    await this.audit.record({
      tenantId,
      action: 'notification.template.created',
      entity: 'NotificationTemplate',
      entityId: created.id,
      actorId,
      metadata: { name: input.name, channel: input.channel },
    });
    return { id: created.id, created: true };
  }

  async remove(tenantId: string, id: string, actorId: string): Promise<void> {
    const existing = await this.prisma.notificationTemplate.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('Notification template not found.');
    await this.prisma.notificationTemplate.deleteMany({ where: { id } });
    await this.audit.record({
      tenantId,
      action: 'notification.template.deleted',
      entity: 'NotificationTemplate',
      entityId: id,
      actorId,
      metadata: { name: existing.name, channel: existing.channel },
    });
  }

  render(
    template: { subject: string | null; body: string },
    context: Record<string, unknown>,
  ): { subject: string | null; body: string } {
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

  async renderByName(
    tenantId: string | null,
    name: string,
    channel: string,
    context: Record<string, unknown>,
  ): Promise<{ subject: string | null; body: string } | null> {
    const template = await this.get(tenantId, name, channel);
    if (!template) return null;
    return this.render(template, context);
  }
}

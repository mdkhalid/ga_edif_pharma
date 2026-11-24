import type { NotificationTemplateSummary } from '@medichain/shared-types';

import { unwrap, unwrapVoid, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/** Tenant notification templates — the admin screen's API. */
export type UpsertNotificationTemplateRequest =
  components['schemas']['UpsertNotificationTemplateDto'];

export interface NotificationTemplatesApi {
  list(): Promise<NotificationTemplateSummary[]>;
  /** Identified by name + channel, not by an id the admin has to remember. */
  upsert(body: UpsertNotificationTemplateRequest): Promise<{ id: string; created: boolean }>;
  remove(id: string): Promise<void>;
}

export function createNotificationTemplatesApi(
  client: MediChainClient,
): NotificationTemplatesApi {
  return {
    async list() {
      return unwrap<NotificationTemplateSummary[]>(
        await client.GET('/notifications/templates'),
      );
    },

    async upsert(body) {
      return unwrap<{ id: string; created: boolean }>(
        await client.PUT('/notifications/templates', { body }),
      );
    },

    async remove(id) {
      await unwrapVoid(
        await client.DELETE('/notifications/templates/{id}', { params: { path: { id } } }),
      );
    },
  };
}

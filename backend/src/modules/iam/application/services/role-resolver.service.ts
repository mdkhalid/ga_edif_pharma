import { Inject, Injectable } from '@nestjs/common';

import { CACHE_TTL, CacheNamespace, cacheKey } from '../../../../infra/cache/cache-keys';
import { CacheService } from '../../../../infra/cache/cache.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { requestContext } from '../../../../common/context/request-context';

/**
 * Expands roles into capabilities.
 *
 * ## Why the cache is keyed by role, not by user
 *
 * A tenant has a handful of roles and thousands of users. Keying the cache by
 * user means thousands of entries holding near-identical lists, all of which must
 * be invalidated when one role changes — and the invalidation is the hard part,
 * because you have to find every user holding it. Keying by role means the entry
 * count equals the role count, and granting a capability to "Order Manager"
 * invalidates exactly one key.
 *
 * ## Why capabilities are not read from the token alone
 *
 * They are in the token for speed, but the token is a snapshot. The caller that
 * trusts it exclusively gives an administrator's permission change a 15-minute
 * delay, which for "revoke this person's access now" is unacceptable. The guard
 * re-resolves through this service, so the cached value — not the token — is
 * authoritative.
 *
 * ## Cache misses are cheap here
 *
 * One indexed query per role, on a table with tens of rows. The cache exists to
 * keep it off the hot path, not because the query is expensive.
 */
@Injectable()
export class RoleResolver {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly cache: CacheService,
  ) {}

  /**
   * Returns the capabilities granted by each role.
   *
   * Unknown role ids are simply absent from the result rather than an error: a
   * role deleted while a user still references it should reduce that user's
   * access, not break their sign-in. The reference is cleaned up by the cascade.
   */
  async capabilitiesForRoles(roleIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (roleIds.length === 0) return result;

    // Unique: a user may hold the same role through two grants.
    const unique = [...new Set(roleIds)];

    const resolved = await Promise.all(
      unique.map(async (roleId) => {
        const cached = await this.cache.get<string[]>(cacheKey(CacheNamespace.ROLE_CAPABILITIES, roleId));
        if (cached !== undefined) return [roleId, cached] as const;

        // `RoleCapability` is classified as a global model, not a tenant-scoped
        // one: capabilities are addressed by `roleId`, and global roles such as
        // SUPER_ADMIN have no tenant for their rows to carry. See the reasoning
        // in `tenant-scoping.extension.ts`.
        //
        // The tenant boundary is therefore held by the caller, not by the query:
        // `roleId` comes from a `UserRole` read filtered on the authenticated
        // user, and the `Role` it points at is itself tenant-scoped. A role id
        // from another tenant is not reachable without already holding that
        // tenant's user id.
        const rows = await this.prisma.roleCapability.findMany({
          where: { roleId },
          select: { capability: true },
        });

        const capabilities = rows.map((row) => row.capability);
        await this.cache.set(
          cacheKey(CacheNamespace.ROLE_CAPABILITIES, roleId),
          capabilities,
          CACHE_TTL.ROLE_CAPABILITIES,
        );
        return [roleId, capabilities] as const;
      }),
    );

    for (const [roleId, capabilities] of resolved) {
      result.set(roleId, capabilities);
    }

    return result;
  }

  /**
   * Flattens role capabilities into the set a principal actually holds.
   *
   * The union, not the intersection: holding two roles grants the combined
   * permissions. Taking the intersection would mean a user with "Warehouse
   * Operator" and "Sales Rep" could do nothing that either role allows, which is
   * never what an administrator intends when assigning both.
   */
  async effectiveCapabilities(roleIds: readonly string[]): Promise<string[]> {
    const byRole = await this.capabilitiesForRoles(roleIds);
    const union = new Set<string>();

    for (const capabilities of byRole.values()) {
      for (const capability of capabilities) union.add(capability);
    }

    return [...union];
  }

  /**
   * Invalidates the cached capabilities for a role.
   *
   * Must be called from the same transaction that changed the role's grants,
   * via an outbox event rather than inline — the cache write is not
   * transactional, so doing it inline would invalidate before a rollback.
   */
  async invalidateRole(roleId: string): Promise<void> {
    await this.cache.invalidate(cacheKey(CacheNamespace.ROLE_CAPABILITIES, roleId));
  }

  /** Invalidates every role in the current tenant. Used by role administration. */
  async invalidateAllRoles(): Promise<number> {
    return this.cache.invalidateNamespace(CacheNamespace.ROLE_CAPABILITIES);
  }

  /** Reads the tenant from the ambient context, for callers that need it. */
  currentTenantId(): string | null {
    return requestContext.tenantId();
  }
}

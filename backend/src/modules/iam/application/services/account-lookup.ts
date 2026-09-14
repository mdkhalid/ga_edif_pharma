import { requestContext } from '../../../../common/context/request-context';
import type { ExtendedPrismaClient } from '../../../../database/prisma.service';
import { identifierCandidates } from '../../domain/identifier';
import type { UserStatus } from '@medichain/shared-types';

/**
 * Pre-authentication account lookup.
 *
 * Contact verification and password reset both run before anyone is signed in,
 * so there is no tenant on the request context and every lookup must run
 * unscoped — otherwise the tenant-scoping extension refuses the query outright
 * (which is the correct behaviour, and the reason this is wrapped rather than
 * left to chance).
 *
 * A plain function rather than an injectable service: it has no state, no
 * collaborators, and both callers already hold a Prisma client. Making it a
 * service would add a provider and a mock to every test for no benefit.
 */

export interface AccountRef {
  readonly id: string;
  readonly tenantId: string | null;
  readonly status: UserStatus;
  readonly email: string | null;
  readonly phone: string | null;
  readonly fullName: string;
}

/**
 * Finds an account by email or phone.
 *
 * Returns `null` for an identifier that cannot be canonicalised and for one that
 * matches nothing — callers must not distinguish the two in a response, or the
 * endpoint becomes an account-enumeration oracle.
 */
export async function findAccountByIdentifier(
  prisma: ExtendedPrismaClient,
  identifier: string,
): Promise<AccountRef | null> {
  const candidates = identifierCandidates(identifier);
  if (candidates.length === 0) return null;

  return requestContext.withoutTenantScope(() =>
    prisma.user.findFirst({
      where: { deletedAt: null, OR: candidates },
      select: {
        id: true,
        tenantId: true,
        status: true,
        email: true,
        phone: true,
        fullName: true,
      },
    }),
  );
}

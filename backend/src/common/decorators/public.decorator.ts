import { SetMetadata } from '@nestjs/common';

import { META } from '../constants/metadata';

/**
 * Marks a route as reachable without authentication.
 *
 * Authentication is opt-OUT, not opt-in: the global `JwtAuthGuard` protects
 * every route unless it is explicitly decorated. A forgotten `@Public()` breaks
 * loudly (a 401 on a route that should be open); a forgotten `@UseGuards()`
 * on the opt-in model would silently expose data. Failing closed is the only
 * acceptable default for a system holding prescription and payment data.
 */
export const Public = () => SetMetadata(META.IS_PUBLIC, true);

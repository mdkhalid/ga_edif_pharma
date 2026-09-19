/**
 * Public API of the `orders` module.
 *
 * The Nest module for wiring, and `OrderService` because placing an order is a
 * use case other code legitimately drives directly — the concurrency and
 * idempotency suites do, and so does the placement load test, none of which can
 * go over HTTP (a placement consumes a cart, so each one needs its own
 * authenticated buyer). Same reasoning as `audit` exporting `AuditService`.
 *
 * Imports from outside must go through this file (enforced by
 * `scripts/check-module-boundaries.mjs`).
 */

export { OrdersModule } from './orders.module';
export { OrderService } from './application/order.service';

import { Capability, SystemRole } from '@medichain/shared-types';

/**
 * The seeded role → capability map.
 *
 * ## Why this is data, not code
 *
 * Authorisation in this system is by capability. A role is a named bundle of
 * capabilities, and the bundles below are the starting point each tenant
 * receives. Because they are rows in the database, a tenant administrator can
 * clone "Order Manager", remove `order:approve`, and call it "Order Clerk" —
 * with no code change and no deploy. That flexibility is the reason roles are
 * rows at all; a hard-coded permission table would make every tenant's
 * organisational difference a support ticket.
 *
 * ## Why the bundles are shaped this way
 *
 * The split follows *responsibility*, not seniority. A `PRICING_MANAGER` holds
 * every pricing capability and no order capability: they decide what a product
 * costs, and someone else decides what to buy. Bundling "seniority" — a manager
 * who can do everything below them — produces accounts that violate separation
 * of duties, which in a system that moves money and controlled medicines is a
 * compliance problem rather than a convenience.
 *
 * `SUPER_ADMIN` is the one role that is not a bundle. It is handled specially by
 * the capability guard because it operates *outside* any tenant, on the platform
 * itself. Granting it every capability here would make it indistinguishable from
 * an over-privileged tenant admin.
 */

/** Capabilities every signed-in user holds, regardless of role. */
const BASELINE: readonly Capability[] = [
  Capability.AUTH_READ_SELF,
  Capability.AUTH_MANAGE_SESSIONS,
];

/** Everything a tenant administrator needs to run their company on the platform. */
const TENANT_ADMIN: readonly Capability[] = [
  Capability.USER_READ,
  Capability.USER_WRITE,
  Capability.USER_DEACTIVATE,
  Capability.ROLE_READ,
  Capability.ROLE_WRITE,
  Capability.ORG_READ,
  Capability.ORG_WRITE,
  Capability.ONBOARDING_READ,
  Capability.ONBOARDING_REVIEW,
  Capability.ONBOARDING_APPROVE,
  Capability.CATALOG_READ,
  Capability.SALT_READ,
  Capability.PRICING_READ,
  Capability.ORDER_READ,
  Capability.ORDER_APPROVE,
  Capability.INVENTORY_READ,
  Capability.CREDIT_READ,
  Capability.PAYMENT_READ,
  Capability.INVOICE_READ,
  Capability.LOGISTICS_READ,
  Capability.RETURN_READ,
  Capability.PRESCRIPTION_READ,
  Capability.REPORT_READ,
  Capability.REPORT_EXPORT,
  Capability.AUDIT_READ,
  Capability.SETTINGS_READ,
  Capability.FEATURE_FLAG_WRITE,
  Capability.SUPPORT_MANAGE,
];

/**
 * A role and the capabilities it grants.
 *
 * `isSystem` marks the seeded roles. They cannot be renamed or deleted through
 * the admin API, because the authorisation rules and the seeds reference them by
 * code — a tenant renaming `ORDER_MANAGER` would break every rule that looks it
 * up. Tenants are expected to *clone* a system role rather than edit it.
 */
export interface RoleDefinition {
  readonly code: SystemRole;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly capabilities: readonly Capability[];
}

/**
 * The seeded roles.
 *
 * Deliberately no `SUPER_ADMIN` entry: it is a platform role, created by the
 * platform seed with `tenantId: null`, and it does not participate in the
 * capability bundles above.
 */
export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    code: SystemRole.TENANT_ADMIN,
    name: 'Tenant Administrator',
    description:
      'Full administrative control of this pharma company: users, roles, settings and ' +
      'read access across every operational area. Cannot approve credit or prices — those ' +
      'are separated deliberately.',
    isSystem: true,
    capabilities: [...BASELINE, ...TENANT_ADMIN],
  },
  {
    code: SystemRole.CATALOG_MANAGER,
    name: 'Catalogue Manager',
    description:
      'Maintains products, manufacturers, packs and the salt composition index. No access ' +
      'to orders or money.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.CATALOG_READ,
      Capability.CATALOG_WRITE,
      Capability.CATALOG_IMPORT,
      Capability.SALT_READ,
      Capability.SALT_WRITE,
      Capability.REPORT_READ,
    ],
  },
  {
    code: SystemRole.PRICING_MANAGER,
    name: 'Pricing Manager',
    description:
      'Sets price lists, customer-specific rates and volume schemes. Deliberately cannot ' +
      'place or approve orders: deciding a price and buying at it are different duties.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.CATALOG_READ,
      Capability.PRICING_READ,
      Capability.PRICING_WRITE,
      Capability.SCHEME_WRITE,
      Capability.REPORT_READ,
    ],
  },
  {
    code: SystemRole.ORDER_MANAGER,
    name: 'Order Manager',
    description:
      'Reviews, modifies, approves and cancels orders. Can see credit standing in order to ' +
      'decide, but cannot change limits.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.CATALOG_READ,
      Capability.PRICING_READ,
      Capability.CART_READ,
      Capability.ORDER_READ,
      Capability.ORDER_APPROVE,
      Capability.ORDER_MODIFY,
      Capability.ORDER_CANCEL,
      Capability.CREDIT_READ,
      Capability.INVENTORY_READ,
      Capability.PRESCRIPTION_READ,
      Capability.REPORT_READ,
    ],
  },
  {
    code: SystemRole.FINANCE,
    name: 'Finance',
    description:
      'Owns credit limits, payments, refunds, tax invoices and credit notes. The only role ' +
      'that may approve a credit-limit change.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.ORDER_READ,
      Capability.CREDIT_READ,
      Capability.CREDIT_WRITE,
      Capability.CREDIT_APPROVE,
      Capability.PAYMENT_READ,
      Capability.PAYMENT_WRITE,
      Capability.PAYMENT_REFUND,
      Capability.INVOICE_READ,
      Capability.INVOICE_WRITE,
      Capability.INVOICE_CANCEL,
      Capability.CREDIT_NOTE_WRITE,
      Capability.REPORT_READ,
      Capability.REPORT_EXPORT,
      Capability.AUDIT_READ,
    ],
  },
  {
    code: SystemRole.WAREHOUSE_OPERATOR,
    name: 'Warehouse Operator',
    description:
      'Picks, packs and dispatches. Sees stock and shipments; cannot see prices, credit or ' +
      'customer commercial terms.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.CATALOG_READ,
      Capability.INVENTORY_READ,
      Capability.INVENTORY_WRITE,
      Capability.INVENTORY_ADJUST,
      Capability.ORDER_READ,
      Capability.LOGISTICS_READ,
      Capability.LOGISTICS_WRITE,
      Capability.RETURN_READ,
      Capability.PRESCRIPTION_READ,
    ],
  },
  {
    code: SystemRole.SALES_REP,
    name: 'Sales Representative',
    description:
      'Places orders on behalf of a customer and tracks them. Cannot approve, cannot change ' +
      'prices, cannot see other customers’ credit limits.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.CATALOG_READ,
      Capability.PRICING_READ,
      Capability.CART_READ,
      Capability.CART_WRITE,
      Capability.ORDER_READ,
      Capability.ORDER_CREATE,
      Capability.CREDIT_READ,
      Capability.INVENTORY_READ,
      Capability.ORG_READ,
    ],
  },
  {
    code: SystemRole.SUPPORT,
    name: 'Support',
    description:
      'Investigates and resolves customer issues. Read-only across orders and prescriptions, ' +
      'plus the ability to manage support tickets. No money, no stock.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.USER_READ,
      Capability.ORG_READ,
      Capability.CATALOG_READ,
      Capability.ORDER_READ,
      Capability.INVENTORY_READ,
      Capability.LOGISTICS_READ,
      Capability.PRESCRIPTION_READ,
      Capability.RETURN_READ,
      Capability.SUPPORT_MANAGE,
      Capability.AUDIT_READ,
    ],
  },
  {
    code: SystemRole.BUYER_ADMIN,
    name: 'Buyer Administrator',
    description:
      'Administers a buying organisation: invites and manages its users, places and tracks ' +
      'orders, and manages its own credit and payment details.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.USER_READ,
      Capability.USER_WRITE,
      Capability.ROLE_READ,
      Capability.ORG_READ,
      Capability.CATALOG_READ,
      Capability.SALT_READ,
      Capability.PRICING_READ,
      Capability.CART_READ,
      Capability.CART_WRITE,
      Capability.ORDER_READ,
      Capability.ORDER_CREATE,
      Capability.ORDER_CANCEL,
      Capability.CREDIT_READ,
      Capability.PAYMENT_READ,
      Capability.PAYMENT_WRITE,
      Capability.INVOICE_READ,
      Capability.LOGISTICS_READ,
      Capability.RETURN_READ,
      Capability.PRESCRIPTION_READ,
      Capability.REPORT_READ,
    ],
  },
  {
    code: SystemRole.BUYER_USER,
    name: 'Buyer',
    description:
      'Orders on behalf of their organisation. Sees the catalogue, their own orders and their ' +
      'organisation’s invoices. Cannot manage users or see the organisation’s credit limit.',
    isSystem: true,
    capabilities: [
      ...BASELINE,
      Capability.CATALOG_READ,
      Capability.SALT_READ,
      Capability.PRICING_READ,
      Capability.CART_READ,
      Capability.CART_WRITE,
      Capability.ORDER_READ,
      Capability.ORDER_CREATE,
      Capability.ORDER_CANCEL,
      Capability.INVOICE_READ,
      Capability.LOGISTICS_READ,
      Capability.RETURN_READ,
      Capability.PRESCRIPTION_READ,
    ],
  },
];

/**
 * Every capability in the system.
 *
 * Used to grant `SUPER_ADMIN` its full set. Deriving it from the `Capability`
 * object rather than listing them means a capability added in a later phase is
 * automatically included, and a test asserts that the platform role can reach
 * every guarded route.
 */
export const ALL_CAPABILITIES: readonly Capability[] = Object.values(Capability);

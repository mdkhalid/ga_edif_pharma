/**
 * Enums and constant maps shared by every MediChain application.
 *
 * These are the single source of truth. The Prisma schema, the database enums
 * and the API contract all reference the same string values, so a client can
 * compare against them directly without a translation layer.
 *
 * ## Why `const` objects and not TypeScript `enum`
 *
 * Every type here is declared as a frozen object plus a derived union type:
 *
 * ```ts
 * export const UserStatus = { ACTIVE: 'ACTIVE' } as const;
 * export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
 * ```
 *
 * rather than `enum UserStatus { ACTIVE = 'ACTIVE' }`. The reason is
 * interoperability with Prisma.
 *
 * Prisma generates its enum types as string-literal unions. TypeScript treats a
 * literal `enum` as a *nominal* type, so a value typed as Prisma's
 * `UserStatus` is **not** assignable to a shared `enum UserStatus`, and vice
 * versa — even though both are the string `'ACTIVE'`. Every boundary between the
 * database and the API would need a cast, and a cast is exactly where a genuine
 * mismatch would hide.
 *
 * With the const-object form, the derived type *is* the string-literal union, so
 * Prisma's types and these types are structurally identical and values flow
 * across the boundary with no cast and full checking.
 *
 * Two further benefits: the objects are erasable (so `isolatedModules` and
 * bundlers that strip types handle them correctly), and they add no runtime
 * enum object to the bundle — which matters for the React Native client.
 */

// ------------------------------------------------------------------ tenancy

export const OrgType = {
  DISTRIBUTOR: 'DISTRIBUTOR',
  WHOLESALER: 'WHOLESALER',
  PHARMACY: 'PHARMACY',
  HOSPITAL: 'HOSPITAL',
} as const;
export type OrgType = (typeof OrgType)[keyof typeof OrgType];

export const OrganisationStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
} as const;
export type OrganisationStatus = (typeof OrganisationStatus)[keyof typeof OrganisationStatus];

export const TenantStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

// ----------------------------------------------------------------------- IAM

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ActorType = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  API_KEY: 'API_KEY',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const SessionRevokedReason = {
  /** The user explicitly logged out. */
  LOGOUT: 'LOGOUT',
  /** Superseded by a rotated token during normal refresh. */
  ROTATED: 'ROTATED',
  /**
   * A refresh token that had already been rotated was presented again.
   * This means the token was stolen and replayed — the whole family is revoked.
   */
  REUSE_DETECTED: 'REUSE_DETECTED',
  ADMIN_FORCED: 'ADMIN_FORCED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  EXPIRED: 'EXPIRED',
} as const;
export type SessionRevokedReason =
  (typeof SessionRevokedReason)[keyof typeof SessionRevokedReason];

export const OtpPurpose = {
  LOGIN: 'LOGIN',
  REGISTER: 'REGISTER',
  RESET_PASSWORD: 'RESET_PASSWORD',
  VERIFY_CONTACT: 'VERIFY_CONTACT',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

/**
 * System role codes. A tenant may define additional custom roles, but these are
 * seeded and referenced by the authorisation rules.
 */
export const SystemRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  TENANT_ADMIN: 'TENANT_ADMIN',
  CATALOG_MANAGER: 'CATALOG_MANAGER',
  PRICING_MANAGER: 'PRICING_MANAGER',
  ORDER_MANAGER: 'ORDER_MANAGER',
  FINANCE: 'FINANCE',
  WAREHOUSE_OPERATOR: 'WAREHOUSE_OPERATOR',
  SALES_REP: 'SALES_REP',
  SUPPORT: 'SUPPORT',
  BUYER_ADMIN: 'BUYER_ADMIN',
  BUYER_USER: 'BUYER_USER',
} as const;
export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

/**
 * Fine-grained capabilities. Roles map to a set of these; guards check them.
 *
 * Deliberately `<resource>:<action>` so a wildcard check (`order:*`) is trivial
 * to add later without renaming anything.
 */
export const Capability = {
  // Identity
  AUTH_READ_SELF: 'auth:read-self',
  AUTH_MANAGE_SESSIONS: 'auth:manage-sessions',
  AUTH_IMPERSONATE: 'auth:impersonate',

  // Users and roles
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DEACTIVATE: 'user:deactivate',
  ROLE_READ: 'role:read',
  ROLE_WRITE: 'role:write',

  // Organisation
  ORG_READ: 'org:read',
  ORG_WRITE: 'org:write',

  // Onboarding
  ONBOARDING_READ: 'onboarding:read',
  ONBOARDING_REVIEW: 'onboarding:review',
  ONBOARDING_APPROVE: 'onboarding:approve',

  // Catalogue
  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',
  CATALOG_IMPORT: 'catalog:import',
  SALT_READ: 'salt:read',
  SALT_WRITE: 'salt:write',

  // Commerce
  CART_READ: 'cart:read',
  CART_WRITE: 'cart:write',
  ORDER_READ: 'order:read',
  ORDER_CREATE: 'order:create',
  ORDER_CANCEL: 'order:cancel',
  ORDER_APPROVE: 'order:approve',
  ORDER_MODIFY: 'order:modify',

  // Inventory
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_APPROVE: 'inventory:approve',

  // Money
  PRICING_READ: 'pricing:read',
  PRICING_WRITE: 'pricing:write',
  SCHEME_WRITE: 'scheme:write',
  CREDIT_READ: 'credit:read',
  CREDIT_WRITE: 'credit:write',
  CREDIT_APPROVE: 'credit:approve',
  PAYMENT_READ: 'payment:read',
  PAYMENT_WRITE: 'payment:write',
  PAYMENT_REFUND: 'payment:refund',
  INVOICE_READ: 'invoice:read',
  INVOICE_WRITE: 'invoice:write',
  INVOICE_CANCEL: 'invoice:cancel',
  CREDIT_NOTE_WRITE: 'credit-note:write',

  // Fulfilment
  LOGISTICS_READ: 'logistics:read',
  LOGISTICS_WRITE: 'logistics:write',
  RETURN_READ: 'return:read',
  RETURN_APPROVE: 'return:approve',
  PRESCRIPTION_READ: 'prescription:read',
  PRESCRIPTION_VERIFY: 'prescription:verify',

  // Reporting and platform
  REPORT_READ: 'report:read',
  REPORT_EXPORT: 'report:export',
  AUDIT_READ: 'audit:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  FEATURE_FLAG_WRITE: 'feature-flag:write',
  JOB_MANAGE: 'job:manage',
  SUPPORT_MANAGE: 'support:manage',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

// --------------------------------------------------------------------- order

export const OrderStatus = {
  DRAFT: 'DRAFT',
  PLACED: 'PLACED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  CONFIRMED: 'CONFIRMED',
  CREDIT_HOLD: 'CREDIT_HOLD',
  PROCESSING: 'PROCESSING',
  PARTIALLY_DISPATCHED: 'PARTIALLY_DISPATCHED',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURNED: 'RETURNED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * The legal order state machine, stated once.
 *
 * Clients use this to decide which actions to offer; the server enforces it.
 * An illegal transition raises `InvalidTransitionError` rather than being
 * silently ignored — an order that quietly jumps states cannot be audited.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ['PLACED', 'CANCELLED'],
  PLACED: ['PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED'],
  PENDING_APPROVAL: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['CREDIT_HOLD', 'PROCESSING', 'CANCELLED'],
  CREDIT_HOLD: ['CONFIRMED', 'CANCELLED'],
  PROCESSING: ['PARTIALLY_DISPATCHED', 'DISPATCHED', 'CANCELLED'],
  PARTIALLY_DISPATCHED: ['DISPATCHED'],
  DISPATCHED: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['PROCESSING', 'CANCELLED'],
  DELIVERED: ['RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED'],
  CANCELLED: [],
  REJECTED: [],
  RETURNED: [],
};

/** Statuses from which no further transition is possible. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'CANCELLED',
  'REJECTED',
  'RETURNED',
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// -------------------------------------------------------------------- pharma

export const ScheduleClass = {
  OTC: 'OTC',
  H: 'H',
  H1: 'H1',
  X: 'X',
  NARCOTIC: 'NARCOTIC',
} as const;
export type ScheduleClass = (typeof ScheduleClass)[keyof typeof ScheduleClass];

/**
 * Schedules that require a verified prescription before dispatch.
 *
 * `H` and above are the Indian Drugs and Cosmetics Rules categories. The list is
 * data rather than a condition scattered through the order flow, so the rule has
 * one definition and one place to change when the regulation does.
 */
export const PRESCRIPTION_REQUIRED_SCHEDULES: readonly ScheduleClass[] = ['H', 'H1', 'X', 'NARCOTIC'];

export const StorageCondition = {
  AMBIENT: 'AMBIENT',
  COOL: 'COOL',
  COLD_CHAIN: 'COLD_CHAIN',
  FROZEN: 'FROZEN',
} as const;
export type StorageCondition = (typeof StorageCondition)[keyof typeof StorageCondition];

export const DosageForm = {
  TABLET: 'TABLET',
  CAPSULE: 'CAPSULE',
  SYRUP: 'SYRUP',
  SUSPENSION: 'SUSPENSION',
  INJECTION: 'INJECTION',
  CREAM: 'CREAM',
  OINTMENT: 'OINTMENT',
  DROPS: 'DROPS',
  INHALER: 'INHALER',
  POWDER: 'POWDER',
  GEL: 'GEL',
  SUPPOSITORY: 'SUPPOSITORY',
} as const;
export type DosageForm = (typeof DosageForm)[keyof typeof DosageForm];

// --------------------------------------------------------------------- money

export const PaymentTerms = {
  ADVANCE: 'ADVANCE',
  COD: 'COD',
  NET15: 'NET15',
  NET30: 'NET30',
  NET45: 'NET45',
  NET60: 'NET60',
} as const;
export type PaymentTerms = (typeof PaymentTerms)[keyof typeof PaymentTerms];

export const PaymentMethod = {
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  CASH: 'CASH',
  CHEQUE: 'CHEQUE',
  ADVANCE: 'ADVANCE',
  CREDIT_NOTE: 'CREDIT_NOTE',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const CreditCheckMode = {
  BLOCK: 'BLOCK',
  WARN: 'WARN',
  APPROVAL: 'APPROVAL',
} as const;
export type CreditCheckMode = (typeof CreditCheckMode)[keyof typeof CreditCheckMode];

// ------------------------------------------------------------- notifications

export const NotificationChannel = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  WHATSAPP: 'WHATSAPP',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

// --------------------------------------------------------------------- audit

/**
 * Whether an audited action succeeded.
 *
 * Failed attempts are recorded as well as successful ones, and deliberately so:
 * "who tried to approve this order and was refused" is a question an
 * investigation asks at least as often as "who approved it". An audit trail that
 * only records successes cannot answer it.
 */
export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;
export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];

// ------------------------------------------------------------- configuration

/**
 * The type of a runtime setting, which determines how its value is stored and
 * parsed. `SECRET` values are encrypted at rest and never returned by an API.
 */
export const PlatformSettingType = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  JSON: 'JSON',
  SECRET: 'SECRET',
} as const;
export type PlatformSettingType = (typeof PlatformSettingType)[keyof typeof PlatformSettingType];

/** Lifecycle of a transactional-outbox row. */
export const OutboxStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

import type { PrismaClient } from '@prisma/client';

import { PlatformSettingType } from '@medichain/shared-types';

import { EncryptionService, buildKeyring } from '../../src/common/utils/encryption.service';

/**
 * Seeds the Layer 2 configuration — everything an operator changes without a
 * redeploy.
 *
 * ## Why the AI settings matter here
 *
 * The brief asked for the AI provider and API key to be changeable at runtime,
 * with no code change and no redeploy. That is only possible if the values live
 * in the database rather than the environment, which is what this seed
 * establishes: an administrator can paste a new provider key into the admin
 * portal and the very next request uses it.
 *
 * The seed writes *defaults*. If `AI_API_KEY` happens to be present in the
 * environment it is adopted once, encrypted, and thereafter the database is
 * authoritative — so an operator who later rotates the key through the UI is not
 * fighting an environment variable that keeps re-imposing the old one.
 *
 * ## Encryption
 *
 * `SECRET` values are encrypted with AES-256-GCM before they are written, using
 * the same `EncryptionService` the application uses. The additional
 * authenticated data is `platform_setting:<key>`, which binds a ciphertext to
 * its own row: copying the encrypted value of a low-privilege setting into a
 * high-privilege row makes decryption fail rather than succeed.
 *
 * A secret is never overwritten on a re-run. If an operator has rotated the key,
 * re-running the seed must not revert it to whatever the environment happened to
 * hold at the time.
 */

interface SettingDefinition {
  readonly key: string;
  readonly type: PlatformSettingType;
  readonly value: string | null;
  /** Read once from the environment on first seed; never overwritten after. */
  readonly fromEnv?: string;
  readonly description: string;
  readonly category: string;
  readonly isRequired?: boolean;
}

const SETTINGS: readonly SettingDefinition[] = [
  // ------------------------------------------------------------------- AI
  {
    key: 'ai.enabled',
    type: PlatformSettingType.BOOLEAN,
    value: 'false',
    description:
      'Master switch for every AI-assisted feature. Disabled by default so that no feature ' +
      'can incur provider cost or send data outside the platform until someone turns it on.',
    category: 'ai',
  },
  {
    key: 'ai.default_provider',
    type: PlatformSettingType.STRING,
    value: 'openai',
    description:
      'Active AI provider. Change this to switch providers with no redeploy — the registry ' +
      'resolves the adapter from this value on the next request.',
    category: 'ai',
  },
  {
    key: 'ai.default_model',
    type: PlatformSettingType.STRING,
    value: 'gpt-4o-mini',
    description: 'Model used when a feature does not name its own.',
    category: 'ai',
  },
  {
    key: 'ai.api_key',
    type: PlatformSettingType.SECRET,
    value: null,
    fromEnv: 'AI_API_KEY',
    description:
      'Provider API key. Encrypted at rest with AES-256-GCM and never returned by any API — ' +
      'the admin UI receives a fingerprint, so "did the key change?" is answerable without ' +
      'disclosing it.',
    category: 'ai',
  },
  {
    key: 'ai.base_url',
    type: PlatformSettingType.STRING,
    value: '',
    fromEnv: 'AI_BASE_URL',
    description:
      'Override the provider endpoint. Set this to point at any OpenAI-compatible service — ' +
      'a self-hosted model, a regional gateway, an on-premise deployment — with no code change.',
    category: 'ai',
  },
  {
    key: 'ai.timeout_ms',
    type: PlatformSettingType.NUMBER,
    value: '30000',
    description: 'Per-request timeout for a provider call, in milliseconds.',
    category: 'ai',
  },
  {
    key: 'ai.max_retries',
    type: PlatformSettingType.NUMBER,
    value: '2',
    description:
      'Retries on a transient provider failure. Retries are only attempted for timeouts and ' +
      '5xx responses — a 4xx is a request problem that a retry cannot fix.',
    category: 'ai',
  },
  {
    key: 'ai.monthly_budget_usd',
    type: PlatformSettingType.NUMBER,
    value: '200',
    description:
      'Hard ceiling on monthly provider spend. When the recorded usage crosses it, AI ' +
      'features degrade to their non-AI behaviour rather than continuing to spend.',
    category: 'ai',
  },
  {
    key: 'ai.features.prescription_ocr',
    type: PlatformSettingType.BOOLEAN,
    value: 'false',
    description: 'Read prescription images and propose the medicines they contain, for a human to verify.',
    category: 'ai',
  },
  {
    key: 'ai.features.semantic_search',
    type: PlatformSettingType.BOOLEAN,
    value: 'false',
    description:
      'Embedding-based product search for vague queries such as "something for a dry cough". ' +
      'Complements the exact salt-composition search rather than replacing it.',
    category: 'ai',
  },
  {
    key: 'ai.features.description_enrich',
    type: PlatformSettingType.BOOLEAN,
    value: 'false',
    description: 'Generate product descriptions for catalogue entries that lack one.',
    category: 'ai',
  },
  {
    key: 'ai.features.demand_forecast',
    type: PlatformSettingType.BOOLEAN,
    value: 'false',
    description: 'Forecast demand per product per region to inform purchase planning.',
    category: 'ai',
  },

  // ----------------------------------------------------------- payments
  {
    key: 'payments.default_provider',
    type: PlatformSettingType.STRING,
    value: process.env['PAYMENT_DEFAULT_PROVIDER'] ?? 'mock',
    description:
      'Active payment gateway. `mock` is for development only and is refused in production — ' +
      'a gateway whose signature verification is a no-op would accept forged webhooks.',
    category: 'payments',
  },

  // ------------------------------------------------------ notifications
  {
    key: 'notifications.sms_provider',
    type: PlatformSettingType.STRING,
    value: process.env['SMS_PROVIDER'] ?? 'console',
    description: 'SMS transport. `console` writes to stdout and must not be used in production.',
    category: 'notifications',
  },

  // ---------------------------------------------------------- commercial
  {
    key: 'orders.require_approval_above',
    type: PlatformSettingType.NUMBER,
    value: '0',
    description:
      'Order value above which an order is routed to PENDING_APPROVAL. Zero disables the ' +
      'threshold, leaving credit-limit checks as the only automatic gate.',
    category: 'orders',
  },
  {
    key: 'orders.reservation_ttl_minutes',
    type: PlatformSettingType.NUMBER,
    value: '30',
    description:
      'How long stock stays reserved against an unpaid order before it is released back to ' +
      'available-to-promise.',
    category: 'orders',
  },
];

export async function seedPlatformSettings(prisma: PrismaClient): Promise<void> {
  // The keyring is built from the environment and validated on construction, so
  // a malformed ENCRYPTION_KEY fails here rather than at the first decrypt in
  // production.
  const encryption = new EncryptionService(buildKeyring(process.env as Record<string, string>));

  let created = 0;
  let skipped = 0;

  for (const setting of SETTINGS) {
    const existing = await prisma.platformSetting.findUnique({
      where: { key: setting.key },
      select: { id: true, type: true },
    });

    if (existing !== null) {
      // Never overwrite. An operator may have changed the value through the
      // admin portal, and a seed run must not undo that.
      skipped += 1;
      continue;
    }

    // A secret is only written if a value is actually available. Writing an
    // empty encrypted string would look configured while being useless — the
    // exact failure mode the environment schema also guards against.
    const plaintext =
      setting.type === PlatformSettingType.SECRET
        ? readEnv(setting.fromEnv)
        : (setting.fromEnv === undefined ? setting.value : (readEnv(setting.fromEnv) ?? setting.value));

    if (setting.type === PlatformSettingType.SECRET && (plaintext === null || plaintext === '')) {
      skipped += 1;
      continue;
    }

    const isSecret = setting.type === PlatformSettingType.SECRET;

    await prisma.platformSetting.create({
      data: {
        key: setting.key,
        type: setting.type,
        description: setting.description,
        category: setting.category,
        isRequired: setting.isRequired ?? false,
        // The AAD binds the ciphertext to this exact row. A value copied into a
        // different setting fails to decrypt rather than being honoured.
        value: isSecret ? null : plaintext,
        encryptedValue: isSecret
          ? encryption.encrypt(plaintext ?? '', `platform_setting:${setting.key}`)
          : null,
      },
    });

    created += 1;
  }

  console.log(`  settings      ${created} created, ${skipped} left unchanged`);
}

function readEnv(name: string | undefined): string | null {
  if (name === undefined) return null;
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

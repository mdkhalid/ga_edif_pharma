import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ConfigurationError } from '../exceptions/domain.exception';
import { sha256Hex } from './crypto.util';

/**
 * AES-256-GCM envelope encryption for secrets held in the database.
 *
 * This is what makes runtime configuration work (docs/13). An operator pastes a
 * new AI provider key into the admin portal; it is encrypted here before it is
 * written to `platform_setting`, and decrypted only in memory at the moment it
 * is used. The database backup therefore never contains a usable credential,
 * and no redeploy is needed to change provider.
 *
 * ## Wire format
 *
 * ```
 *   byte  0        keyVersion   (1 byte, 0x01 for the current key)
 *   bytes 1..12    iv           (12 bytes — GCM's native nonce size)
 *   bytes 13..28   authTag      (16 bytes)
 *   bytes 29..     ciphertext   (remainder)
 * ```
 *
 * Stored base64-encoded. The version byte is what allows rotation: add a new key
 * as `v2`, re-encrypt lazily, and decrypt still works for rows written under
 * `v1` because the reader knows which key to reach for.
 *
 * ## Why GCM and not CBC
 *
 * GCM is authenticated: a modified ciphertext fails the tag check rather than
 * decrypting to garbage that then flows into a provider request. CBC would
 * require a separate HMAC and a padding oracle is easy to introduce.
 *
 * ## Why `aad` matters
 *
 * Additional authenticated data binds a ciphertext to its location — typically
 * `platform_setting:<id>`. Without it, an attacker with write access to the
 * table could copy the ciphertext of a low-privilege setting into a
 * high-privilege row and have it decrypt successfully. With AAD, the swap fails
 * authentication. Encryption without context binding protects confidentiality
 * but not integrity of *placement*.
 */

const KEY_VERSION_CURRENT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const ENCRYPTION_KEYS = Symbol('ENCRYPTION_KEYS');

export interface EncryptionKeyring {
  /** Key version to use for new writes. */
  readonly currentVersion: number;
  /** Version to raw 32-byte key. Contains the current key and any older ones. */
  readonly keys: ReadonlyMap<number, Buffer>;
}

/**
 * Builds a keyring from the environment.
 *
 * `ENCRYPTION_KEY` is the current key (version 1). Rotation adds
 * `ENCRYPTION_KEY_V2`, `ENCRYPTION_KEY_V3`, … — new writes use the highest
 * version present, older versions remain readable.
 */
export function buildKeyring(env: Record<string, string | undefined>): EncryptionKeyring {
  const keys = new Map<number, Buffer>();

  const primary = env.ENCRYPTION_KEY;
  if (primary === undefined || primary === '') {
    throw new ConfigurationError(
      'ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  keys.set(KEY_VERSION_CURRENT, decodeKey(primary, 'ENCRYPTION_KEY'));

  for (let version = 2; version <= 8; version += 1) {
    const raw = env[`ENCRYPTION_KEY_V${version}`];
    if (raw === undefined || raw === '') continue;
    keys.set(version, decodeKey(raw, `ENCRYPTION_KEY_V${version}`));
  }

  const currentVersion = Math.max(...keys.keys());
  return { currentVersion, keys };
}

function decodeKey(raw: string, name: string): Buffer {
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length !== KEY_BYTES) {
    throw new ConfigurationError(
      `${name} must decode to exactly ${KEY_BYTES} bytes (got ${buffer.length}). ` +
        'A wrong-length key fails at the first decrypt, which is far too late to notice.',
      { variable: name, decodedLength: buffer.length },
    );
  }
  return buffer;
}

@Injectable()
export class EncryptionService {
  constructor(@Inject(ENCRYPTION_KEYS) private readonly keyring: EncryptionKeyring) {}

  /** Encrypts a UTF-8 string. Returns base64 of the framed envelope. */
  encrypt(plaintext: string, aad?: string): string {
    const version = this.keyring.currentVersion;
    const key = this.requireKey(version);

    // A fresh random IV per encryption is mandatory. Reusing an IV under the
    // same key in GCM is catastrophic: it leaks the XOR of plaintexts and
    // destroys the authentication guarantee.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([Buffer.from([version]), iv, tag, ciphertext]).toString('base64');
  }

  /**
   * Decrypts a value produced by `encrypt`.
   *
   * Throws `ConfigurationError` when the envelope is malformed or the tag does
   * not verify. It deliberately does not return `null` on failure: a caller
   * that treats a failed decrypt as "no secret configured" would silently fall
   * back to an unauthenticated provider.
   */
  decrypt(envelope: string, aad?: string): string {
    const raw = Buffer.from(envelope, 'base64');

    if (raw.length < 1 + IV_BYTES + TAG_BYTES) {
      throw new ConfigurationError('Encrypted value is malformed (too short).');
    }

    const version = raw.readUInt8(0);
    const key = this.requireKey(version);

    const iv = raw.subarray(1, 1 + IV_BYTES);
    const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(1 + IV_BYTES + TAG_BYTES);

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Never surface the underlying error: it distinguishes "wrong key" from
      // "tampered ciphertext", which is useful to an attacker and to nobody else.
      throw new ConfigurationError(
        'Failed to decrypt a stored secret. The value was encrypted with a different key, ' +
          'or has been modified since it was written.',
        { keyVersion: version },
      );
    }
  }

  /**
   * Encrypts, or returns `null` for an absent value.
   *
   * Convenience for optional settings, so callers do not repeat the null check.
   */
  encryptOptional(plaintext: string | null | undefined, aad?: string): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    return this.encrypt(plaintext, aad);
  }

  /** Decrypts, returning `null` when the envelope is absent. */
  decryptOptional(envelope: string | null | undefined, aad?: string): string | null {
    if (envelope === null || envelope === undefined || envelope === '') return null;
    return this.decrypt(envelope, aad);
  }

  /**
   * Renders a secret safe for logs: a stable fingerprint, never the value.
   *
   * Showing `sk-…4f2a` style hints is tempting but a 4-character suffix of a
   * 51-character key narrows a brute-force search. A hash is enough to answer
   * "did the key change?" without leaking anything.
   */
  fingerprint(envelope: string): string {
    return createFingerprint(envelope);
  }

  private requireKey(version: number): Buffer {
    const key = this.keyring.keys.get(version);
    if (key === undefined) {
      throw new ConfigurationError(
        `No encryption key is configured for version ${version}. A key was removed from the ` +
          'environment while data encrypted with it still exists — restore it to read those rows.',
        { keyVersion: version, availableVersions: [...this.keyring.keys.keys()] },
      );
    }
    return key;
  }
}

/** Stable, non-reversible identifier for a secret. Answers "did it change?". */
function createFingerprint(envelope: string): string {
  return `sha256:${sha256Hex(envelope).slice(0, 12)}`;
}

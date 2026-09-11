import { ConfigurationError } from '../../src/common/exceptions/domain.exception';
import {
  ENCRYPTION_KEYS,
  EncryptionService,
  buildKeyring,
} from '../../src/common/utils/encryption.service';

/**
 * Envelope encryption protects every Layer 2 secret at rest (docs/13). These
 * tests pin the properties that make it safe rather than merely functional:
 * a fresh IV per write, AAD binding of ciphertext to its row, and failure on
 * tampering instead of decryption to garbage.
 */

const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');
const KEY_V3 = Buffer.alloc(32, 3).toString('base64');

function serviceFor(env: Record<string, string | undefined>): EncryptionService {
  return new EncryptionService(buildKeyring(env));
}

describe('buildKeyring', () => {
  it('refuses to build without a key, with a command to generate one', () => {
    expect(() => buildKeyring({})).toThrow(ConfigurationError);
    expect(() => buildKeyring({})).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => buildKeyring({})).toThrow(/randomBytes\(32\)/);
  });

  it('rejects a key that does not decode to exactly 32 bytes', () => {
    // A short key must fail at boot, not at the first decrypt in production.
    expect(() => buildKeyring({ ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/exactly 32 bytes/);
  });

  it('reports the actual decoded length, so the mistake is obvious', () => {
    expect(() => buildKeyring({ ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/got 5/);
  });

  it('starts at version 1', () => {
    const keyring = buildKeyring({ ENCRYPTION_KEY: KEY_V1 });
    expect(keyring.currentVersion).toBe(1);
    expect([...keyring.keys.keys()]).toEqual([1]);
  });

  it('uses the highest version present for new writes', () => {
    const keyring = buildKeyring({
      ENCRYPTION_KEY: KEY_V1,
      ENCRYPTION_KEY_V2: KEY_V2,
      ENCRYPTION_KEY_V3: KEY_V3,
    });

    expect(keyring.currentVersion).toBe(3);
    // Older keys are retained so existing rows stay readable.
    expect([...keyring.keys.keys()].sort()).toEqual([1, 2, 3]);
  });

  it('ignores empty rotation slots rather than treating them as keys', () => {
    const keyring = buildKeyring({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: '' });
    expect(keyring.currentVersion).toBe(1);
  });
});

describe('EncryptionService round trip', () => {
  it('decrypts what it encrypted', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const plaintext = 'sk-test-abcdefghijklmnopqrstuvwxyz0123456789';

    expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
  });

  it('handles an empty string', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    expect(service.decrypt(service.encrypt(''))).toBe('');
  });

  it('handles multi-byte UTF-8 without corrupting it', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const plaintext = 'सूर्य फार्मा — ₹1,23,456.78 — Ω';
    expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext every time', () => {
    // A fresh IV per write. Reusing one under GCM leaks the XOR of plaintexts
    // and destroys authentication, so this is a correctness property.
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const a = service.encrypt('same-value');
    const b = service.encrypt('same-value');

    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe('same-value');
    expect(service.decrypt(b)).toBe('same-value');
  });

  it('stamps the envelope with the current key version', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });
    const envelope = Buffer.from(service.encrypt('x'), 'base64');

    expect(envelope.readUInt8(0)).toBe(2);
  });
});

describe('AAD binds a ciphertext to its row', () => {
  it('decrypts when the AAD matches', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = service.encrypt('secret', 'platform_setting:ai.api_key');

    expect(service.decrypt(envelope, 'platform_setting:ai.api_key')).toBe('secret');
  });

  it('fails when the AAD names a different row', () => {
    // This is the attack the AAD exists to stop: copy the ciphertext of a
    // low-privilege setting into a high-privilege row and have it decrypt.
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = service.encrypt('low-privilege-value', 'platform_setting:theme');

    expect(() => service.decrypt(envelope, 'platform_setting:ai.api_key')).toThrow(
      /different key, or has been modified/,
    );
  });

  it('fails when the AAD is omitted on decrypt but was used on encrypt', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = service.encrypt('secret', 'platform_setting:x');

    expect(() => service.decrypt(envelope)).toThrow(ConfigurationError);
  });

  it('fails when the AAD is supplied on decrypt but was omitted on encrypt', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = service.encrypt('secret');

    expect(() => service.decrypt(envelope, 'platform_setting:x')).toThrow(ConfigurationError);
  });
});

describe('tamper and key-mismatch detection', () => {
  /** Flips the low bit of the byte at `offset`, in place. */
  const flipByte = (buffer: Buffer, offset: number): void => {
    buffer.writeUInt8(buffer.readUInt8(offset) ^ 0xff, offset);
  };

  it('rejects a modified ciphertext', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = Buffer.from(service.encrypt('secret'), 'base64');
    flipByte(envelope, envelope.length - 1);

    expect(() => service.decrypt(envelope.toString('base64'))).toThrow(ConfigurationError);
  });

  it('rejects a modified authentication tag', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = Buffer.from(service.encrypt('secret'), 'base64');
    flipByte(envelope, 13); // first byte of the tag, after the 1-byte version and 12-byte IV

    expect(() => service.decrypt(envelope.toString('base64'))).toThrow(ConfigurationError);
  });

  it('rejects an envelope written under a different key', () => {
    const writer = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const reader = serviceFor({ ENCRYPTION_KEY: KEY_V2 });

    expect(() => reader.decrypt(writer.encrypt('secret'))).toThrow(ConfigurationError);
  });

  it('does not reveal whether the key or the ciphertext was wrong', () => {
    // Distinguishing the two is useful to an attacker and to nobody else.
    const writer = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const reader = serviceFor({ ENCRYPTION_KEY: KEY_V2 });

    const tampered = Buffer.from(writer.encrypt('secret'), 'base64');
    flipByte(tampered, tampered.length - 1);

    expect(() => reader.decrypt(writer.encrypt('secret'))).toThrow(
      /different key, or has been modified/,
    );
    expect(() => writer.decrypt(tampered.toString('base64'))).toThrow(
      /different key, or has been modified/,
    );
  });

  it('rejects a malformed envelope that is too short to contain a header', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    expect(() => service.decrypt(Buffer.from('short').toString('base64'))).toThrow(
      /malformed \(too short\)/,
    );
  });
});

describe('key rotation', () => {
  it('reads rows written under an older key after a new one is added', () => {
    const beforeRotation = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = beforeRotation.encrypt('written-under-v1');

    const afterRotation = serviceFor({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });

    expect(afterRotation.decrypt(envelope)).toBe('written-under-v1');
  });

  it('writes under the new key while still reading the old', () => {
    const afterRotation = serviceFor({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });
    const envelope = Buffer.from(afterRotation.encrypt('fresh'), 'base64');

    expect(envelope.readUInt8(0)).toBe(2);
    expect(afterRotation.decrypt(envelope.toString('base64'))).toBe('fresh');
  });

  it('explains the problem when the key for a stored version was removed', () => {
    // Removing a key while data encrypted with it still exists is an operator
    // error that must name itself, not surface as a generic decrypt failure.
    const withV2 = serviceFor({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });
    const envelope = withV2.encrypt('written-under-v2');

    const withoutV2 = serviceFor({ ENCRYPTION_KEY: KEY_V1 });

    expect(() => withoutV2.decrypt(envelope)).toThrow(/No encryption key is configured for version 2/);
    expect(() => withoutV2.decrypt(envelope)).toThrow(/restore it to read those rows/);
  });
});

describe('optional helpers', () => {
  it('encrypts a present value and passes absence through as null', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });

    expect(service.encryptOptional(null)).toBeNull();
    expect(service.encryptOptional(undefined)).toBeNull();
    expect(service.encryptOptional('')).toBeNull();

    const envelope = service.encryptOptional('value');
    expect(envelope).not.toBeNull();
    expect(service.decryptOptional(envelope)).toBe('value');
  });

  it('decrypts a present envelope and passes absence through as null', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });

    expect(service.decryptOptional(null)).toBeNull();
    expect(service.decryptOptional(undefined)).toBeNull();
    expect(service.decryptOptional('')).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is stable for the same envelope', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const envelope = service.encrypt('secret');

    expect(service.fingerprint(envelope)).toBe(service.fingerprint(envelope));
  });

  it('changes when the secret changes', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    expect(service.fingerprint(service.encrypt('a'))).not.toBe(
      service.fingerprint(service.encrypt('b')),
    );
  });

  it('does not contain the plaintext', () => {
    // A `sk-…4f2a` style hint narrows a brute-force search; a hash does not.
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    const plaintext = 'sk-live-abcdefghijklmnop';

    expect(service.fingerprint(service.encrypt(plaintext))).not.toContain(plaintext);
  });

  it('is labelled so it cannot be mistaken for the value', () => {
    const service = serviceFor({ ENCRYPTION_KEY: KEY_V1 });
    expect(service.fingerprint(service.encrypt('x'))).toMatch(/^sha256:[0-9a-f]{12}$/);
  });
});

describe('the injection token', () => {
  it('is a symbol, so it cannot collide with a string provider token', () => {
    expect(typeof ENCRYPTION_KEYS).toBe('symbol');
  });
});

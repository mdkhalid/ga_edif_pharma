import { createHash } from 'node:crypto';

import {
  deterministicUuid,
  randomInt,
  randomNumericCode,
  randomToken,
  sha256Base64,
  sha256Hex,
  stableJsonDigest,
  stableStringify,
  timingSafeEqualString,
} from '../../src/common/utils/crypto.util';

describe('randomToken', () => {
  it('is URL-safe, so it survives a query string or a header unescaped', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries the requested entropy', () => {
    // 32 bytes base64url is 43 characters without padding.
    expect(randomToken()).toHaveLength(43);
    expect(randomToken(16)).toHaveLength(22);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken()));
    expect(tokens.size).toBe(500);
  });
});

describe('randomNumericCode', () => {
  it('is the requested length, zero-padded', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = randomNumericCode(6);
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('honours a non-default length', () => {
    expect(randomNumericCode(4)).toHaveLength(4);
    expect(randomNumericCode(8)).toHaveLength(8);
  });
});

describe('sha256', () => {
  it('matches the known digest of the empty string', () => {
    // A fixed vector, so a refactor that changes the encoding is caught.
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known digest of "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces base64 of the same digest in hex form', () => {
    const hex = sha256Hex('abc');
    const base64 = sha256Base64('abc');
    expect(Buffer.from(hex, 'hex').toString('base64')).toBe(base64);
  });

  it('hashes UTF-8 rather than UTF-16 code units', () => {
    // A naive implementation that hashed the JS string's code units would give a
    // different digest for non-ASCII input, so the digest is pinned against an
    // independently computed one.
    const expected = createHash('sha256').update('सूर्य', 'utf8').digest('hex');
    expect(sha256Hex('सूर्य')).toBe(expected);

    // And it must differ from the UTF-16 interpretation.
    const utf16 = createHash('sha256').update(Buffer.from('सूर्य', 'utf16le')).digest('hex');
    expect(sha256Hex('सूर्य')).not.toBe(utf16);
  });
});

describe('stableStringify', () => {
  it('is independent of key insertion order', () => {
    // This is the whole point: an idempotency fingerprint must not depend on the
    // order the caller happened to build its object in.
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('sorts nested objects too', () => {
    const left = { outer: { z: 1, a: 2 }, list: [{ y: 1, x: 2 }] };
    const right = { list: [{ x: 2, y: 1 }], outer: { a: 2, z: 1 } };
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it('preserves array order, which is semantically meaningful', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it('drops undefined properties rather than emitting null', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('keeps null, which is a deliberate value', () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });

  it('handles primitives and top-level null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(true)).toBe('true');
  });
});

describe('stableJsonDigest', () => {
  it('gives the same digest for reordered keys', () => {
    expect(stableJsonDigest({ orderId: 'o1', amount: '100.0000' })).toBe(
      stableJsonDigest({ amount: '100.0000', orderId: 'o1' }),
    );
  });

  it('gives different digests for different values', () => {
    expect(stableJsonDigest({ amount: '100.0000' })).not.toBe(
      stableJsonDigest({ amount: '100.0001' }),
    );
  });
});

describe('timingSafeEqualString', () => {
  it('accepts identical strings', () => {
    expect(timingSafeEqualString('token-value', 'token-value')).toBe(true);
  });

  it('rejects different strings of the same length', () => {
    expect(timingSafeEqualString('token-value', 'token-valuf')).toBe(false);
  });

  it('does not throw on different lengths', () => {
    // `crypto.timingSafeEqual` throws when lengths differ, which would leak the
    // length through the error. Hashing both sides first avoids that.
    expect(() => timingSafeEqualString('short', 'a-much-longer-value')).not.toThrow();
    expect(timingSafeEqualString('short', 'a-much-longer-value')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeEqualString('', '')).toBe(true);
    expect(timingSafeEqualString('', 'x')).toBe(false);
  });
});

describe('randomInt', () => {
  it('stays within range', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = randomInt(10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
  });

  it('rejects a non-positive bound instead of silently returning 0', () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(-1)).toThrow(RangeError);
  });
});

describe('deterministicUuid', () => {
  it('is stable for the same namespace and value', () => {
    // Seeds and idempotent migrations rely on this to target the same row.
    expect(deterministicUuid('role', 'TENANT_ADMIN')).toBe(
      deterministicUuid('role', 'TENANT_ADMIN'),
    );
  });

  it('separates the namespace from the value', () => {
    // Without the separator, ('ab','c') and ('a','bc') would collide.
    expect(deterministicUuid('ab', 'c')).not.toBe(deterministicUuid('a', 'bc'));
  });

  it('differs for different values', () => {
    expect(deterministicUuid('role', 'A')).not.toBe(deterministicUuid('role', 'B'));
  });

  it('is shaped like a v4 UUID', () => {
    expect(deterministicUuid('role', 'TENANT_ADMIN')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

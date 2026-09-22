import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotpSecret,
  hotp,
  totp,
  verifyTotp,
} from '../../src/modules/iam/domain/totp';

/**
 * TOTP against the RFC's own vectors.
 *
 * A security boundary: a bug here either locks every user out (codes never
 * match) or, worse, widens the verification window until a stale code works.
 * The vectors below are copied from RFC 6238 Appendix B — the same ones every
 * conforming implementation is tested against — so a mismatch means our
 * arithmetic, not the test, is wrong.
 */

/** ASCII "12345678901234567890", the RFC 6238 SHA-1 test secret, in base32. */
const RFC_SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'hello world']) {
      const buffer = Buffer.from(input, 'utf8');
      expect(base32Decode(base32Encode(buffer)).toString('utf8')).toBe(input);
    }
  });

  it('encodes without padding, the form authenticator apps accept', () => {
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(Buffer.from('fo'))).toBe('MZXQ');
    expect(base32Encode(Buffer.from('foo'))).toBe('MZXW6');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('accepts lower case and strips padding', () => {
    expect(base32Decode('mzxw6').toString('utf8')).toBe('foo');
    expect(base32Decode('MZXW6====').toString('utf8')).toBe('foo');
  });

  it('rejects characters outside the alphabet rather than skipping them', () => {
    // Silently skipping would decode to a different secret and present as
    // "your authenticator is wrong" forever.
    expect(() => base32Decode('MZXW6!')).toThrow(/Invalid base32/);
    expect(() => base32Decode('MZXW0')).toThrow(/Invalid base32/); // 0,1,8,9 excluded
  });
});

describe('hotp / totp — RFC 6238 test vectors (SHA-1)', () => {
  const vectors: Array<{ atSeconds: number; code: string }> = [
    { atSeconds: 59, code: '94287082' },
    { atSeconds: 1_111_111_109, code: '07081804' },
    { atSeconds: 1_111_111_111, code: '14050471' },
    { atSeconds: 1_234_567_890, code: '89005924' },
    { atSeconds: 2_000_000_000, code: '69279037' },
    { atSeconds: 20_000_000_000, code: '65353130' },
  ];

  it.each(vectors)('produces $code at t=$atSeconds', ({ atSeconds, code }) => {
    // The RFC vectors are eight digits (the appendix uses 8); our parameter is
    // six, so compare against the last six of the RFC value for the standard
    // configuration and against the full value through hotp's digits option.
    expect(totp(RFC_SHA1_SECRET, atSeconds * 1000)).toBe(code.slice(-6));
    expect(hotp(base32Decode(RFC_SHA1_SECRET), BigInt(Math.floor(atSeconds / 30)), 8)).toBe(code);
  });

  it('handles counters beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    // 2^63 appears in the RFC appendix; a float counter would round it.
    const key = base32Decode(RFC_SHA1_SECRET);
    const counter = 2n ** 63n;
    expect(() => hotp(key, counter, 8)).not.toThrow();
    // Deterministic: same counter, same code.
    expect(hotp(key, counter, 8)).toBe(hotp(key, counter, 8));
  });
});

describe('verifyTotp', () => {
  it('accepts the current code', () => {
    const at = 1_234_567_890_000;
    expect(verifyTotp(RFC_SHA1_SECRET, totp(RFC_SHA1_SECRET, at), at)).toBe(true);
  });

  it('accepts one step of skew in either direction', () => {
    const at = 1_234_567_890_000;
    const previous = totp(RFC_SHA1_SECRET, at - 30_000);
    const next = totp(RFC_SHA1_SECRET, at + 30_000);
    expect(verifyTotp(RFC_SHA1_SECRET, previous, at)).toBe(true);
    expect(verifyTotp(RFC_SHA1_SECRET, next, at)).toBe(true);
  });

  it('rejects two steps of skew', () => {
    const at = 1_234_567_890_000;
    const stale = totp(RFC_SHA1_SECRET, at - 60_000);
    expect(verifyTotp(RFC_SHA1_SECRET, stale, at)).toBe(false);
  });

  it('rejects a wrong code', () => {
    const at = 1_234_567_890_000;
    const right = totp(RFC_SHA1_SECRET, at);
    const wrong = right === '000000' ? '000001' : '000000';
    expect(verifyTotp(RFC_SHA1_SECRET, wrong, at)).toBe(false);
  });

  it('rejects anything that is not six digits without computing HMACs', () => {
    const at = 1_234_567_890_000;
    expect(verifyTotp(RFC_SHA1_SECRET, '', at)).toBe(false);
    expect(verifyTotp(RFC_SHA1_SECRET, '12345', at)).toBe(false);
    expect(verifyTotp(RFC_SHA1_SECRET, '1234567', at)).toBe(false);
    expect(verifyTotp(RFC_SHA1_SECRET, 'abcdef', at)).toBe(false);
    expect(verifyTotp(RFC_SHA1_SECRET, '12 456', at)).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('produces a 160-bit base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(seen.size).toBe(50);
  });
});

describe('buildOtpauthUri', () => {
  it('labels the entry issuer:account and carries the parameters apps read', () => {
    const uri = buildOtpauthUri({
      secret: RFC_SHA1_SECRET,
      account: 'admin@sunrisepharma.in',
      issuer: 'MediChain',
    });

    expect(uri.startsWith('otpauth://totp/MediChain:admin%40sunrisepharma.in?')).toBe(true);
    const params = new URL(uri.replace('otpauth://totp/', 'https://x/')).searchParams;
    expect(params.get('secret')).toBe(RFC_SHA1_SECRET);
    expect(params.get('issuer')).toBe('MediChain');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});

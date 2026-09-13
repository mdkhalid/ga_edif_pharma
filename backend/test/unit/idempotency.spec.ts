import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';

import {
  IdempotencyKeyReusedError,
  RequestInProgressError,
  ValidationFailedError,
} from '../../src/common/exceptions/domain.exception';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';
import {
  type IdempotencyBeginResult,
  type IdempotencyRecord,
  type IdempotencyStore,
} from '../../src/common/ports/idempotency.port';
import { idempotencyKey } from '../../src/infra/cache/cache-keys';
import { RedisIdempotencyStore } from '../../src/infra/cache/redis-idempotency.store';
import type { RedisService } from '../../src/infra/cache/redis.service';

const OK_HEADER = 'idempotency-key';

function makeContext(
  request: Record<string, unknown>,
  response: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => function handler(): void {},
    getClass: () => class StubController {},
  } as unknown as ExecutionContext;
}

function makeReflector(options: unknown): Reflector {
  return { getAllAndOverride: () => options } as unknown as Reflector;
}

function staticHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

/** A store whose `begin` outcome is scripted, recording `complete`/`release`. */
class ScriptedStore implements IdempotencyStore {
  beginResult: IdempotencyBeginResult = { outcome: 'acquired' };
  readonly completed: Array<{ status: number; body: unknown; ttlSeconds: number }> = [];
  readonly released: string[] = [];
  beginCalls = 0;

  async begin(): Promise<IdempotencyBeginResult> {
    this.beginCalls += 1;
    return this.beginResult;
  }

  async complete(
    _scope: string,
    _fingerprint: string,
    status: number,
    body: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    this.completed.push({ status, body, ttlSeconds });
  }

  async release(scope: string): Promise<void> {
    this.released.push(scope);
  }
}

/** A store that really deduplicates, so fingerprint behaviour is observable. */
class InMemoryStore implements IdempotencyStore {
  private readonly records = new Map<string, { fingerprint: string; status: number; body: unknown }>();

  async begin(scope: string, fingerprint: string): Promise<IdempotencyBeginResult> {
    const existing = this.records.get(scope);
    if (existing === undefined) return { outcome: 'acquired' };
    if (existing.fingerprint !== fingerprint) return { outcome: 'mismatch' };
    return { outcome: 'replay', status: existing.status, body: existing.body };
  }

  async complete(
    scope: string,
    fingerprint: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    this.records.set(scope, { fingerprint, status, body });
  }

  async release(scope: string): Promise<void> {
    this.records.delete(scope);
  }
}

describe('IdempotencyInterceptor', () => {
  it('runs the handler and persists the response when the key is claimed', async () => {
    const store = new ScriptedStore();
    const interceptor = new IdempotencyInterceptor(makeReflector({ ttlSeconds: 60 }), store);
    const response = { statusCode: 201 };

    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body: { a: 1 } }, response),
        staticHandler({ data: { userId: 'u1' } }),
      ),
    );

    expect(result).toEqual({ data: { userId: 'u1' } });
    expect(store.completed).toEqual([
      { status: 201, body: { data: { userId: 'u1' } }, ttlSeconds: 60 },
    ]);
  });

  it('replays the stored response without invoking the handler', async () => {
    const store = new ScriptedStore();
    store.beginResult = { outcome: 'replay', status: 200, body: { data: { userId: 'u9' } } };
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);
    const response: { statusCode?: number } = { statusCode: 201 };

    let handlerCalled = false;
    const handler: CallHandler = {
      handle: () => {
        handlerCalled = true;
        return of('should-not-run');
      },
    };

    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body: {} }, response),
        handler,
      ),
    );

    expect(result).toEqual({ data: { userId: 'u9' } });
    expect(handlerCalled).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(store.completed).toHaveLength(0);
  });

  it('rejects a request whose key was used with a different body', async () => {
    const store = new ScriptedStore();
    store.beginResult = { outcome: 'mismatch' };
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);

    await expect(
      firstValueFrom(
        interceptor.intercept(
          makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body: {} }),
          staticHandler('x'),
        ),
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('rejects a duplicate that arrives while the first is still running', async () => {
    const store = new ScriptedStore();
    store.beginResult = { outcome: 'in-progress' };
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);

    await expect(
      firstValueFrom(
        interceptor.intercept(
          makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body: {} }),
          staticHandler('x'),
        ),
      ),
    ).rejects.toBeInstanceOf(RequestInProgressError);
  });

  it('fails open when the store is unavailable', async () => {
    const store = new ScriptedStore();
    store.beginResult = { outcome: 'unavailable' };
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);

    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body: {} }),
        staticHandler('ran'),
      ),
    );

    expect(result).toBe('ran');
    // Nothing was stored, so nothing must be released or completed either.
    expect(store.completed).toHaveLength(0);
    expect(store.released).toHaveLength(0);
  });

  it('releases the marker when the handler fails', async () => {
    const store = new ScriptedStore();
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);

    await expect(
      firstValueFrom(
        interceptor.intercept(
          makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body: {} }),
          { handle: () => throwError(() => new Error('boom')) },
        ),
      ),
    ).rejects.toThrow('boom');

    expect(store.released).toHaveLength(1);
    expect(store.completed).toHaveLength(0);
  });

  it('requires an Idempotency-Key header on an idempotent route', () => {
    const store = new ScriptedStore();
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);

    expect(() =>
      interceptor.intercept(
        makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: {}, body: {} }),
        staticHandler('x'),
      ),
    ).toThrow(ValidationFailedError);
    expect(store.beginCalls).toBe(0);
  });

  it('leaves non-idempotent routes untouched', async () => {
    const store = new ScriptedStore();
    const interceptor = new IdempotencyInterceptor(makeReflector(undefined), store);

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ method: 'GET', headers: {} }), staticHandler('plain')),
    );

    expect(result).toBe('plain');
    expect(store.beginCalls).toBe(0);
  });

  it('fingerprints the body independently of key order', async () => {
    const store = new InMemoryStore();
    const interceptor = new IdempotencyInterceptor(makeReflector({}), store);
    const request = (body: unknown): ReturnType<typeof makeContext> =>
      makeContext({ method: 'POST', route: { path: '/auth/register' }, headers: { [OK_HEADER]: 'k1' }, body });

    // First request claims the key.
    await firstValueFrom(interceptor.intercept(request({ a: 1, b: 2 }), staticHandler('first')));

    // Same body, keys reordered — a retry, not a conflict.
    const replayed = await firstValueFrom(
      interceptor.intercept(request({ b: 2, a: 1 }), staticHandler('second')),
    );
    expect(replayed).toBe('first');

    // Genuinely different body — a client bug.
    await expect(
      firstValueFrom(interceptor.intercept(request({ a: 1, b: 3 }), staticHandler('third'))),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });
});

/** Minimal stand-in for `RedisService`, mirroring its prefixing contract. */
class FakeRedis {
  private readonly values = new Map<string, string>();
  failCommands = false;

  withPrefix(key: string): string {
    return `test:${key}`;
  }

  get raw(): { set: (...args: unknown[]) => Promise<'OK' | null> } {
    return {
      set: async (...args: unknown[]): Promise<'OK' | null> => {
        if (this.failCommands) throw new Error('redis down');
        const [key, value] = args as [string, string];
        if (this.values.has(key)) return null;
        this.values.set(key, value);
        return 'OK';
      },
    };
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = this.values.get(this.withPrefix(key));
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) throw new Error('ttl must be positive');
    if (this.failCommands) throw new Error('redis down');
    this.values.set(this.withPrefix(key), JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    if (this.failCommands) throw new Error('redis down');
    this.values.delete(this.withPrefix(key));
  }
}

describe('RedisIdempotencyStore', () => {
  const asRedis = (fake: FakeRedis): RedisService => fake as unknown as RedisService;

  it('claims an unused key', async () => {
    const store = new RedisIdempotencyStore(asRedis(new FakeRedis()));
    await expect(store.begin('POST /x k1', 'fp', 60)).resolves.toEqual({ outcome: 'acquired' });
  });

  it('reports in-progress for a key that is still running', async () => {
    const fake = new FakeRedis();
    const store = new RedisIdempotencyStore(asRedis(fake));
    await store.begin('POST /x k1', 'fp', 60);

    await expect(store.begin('POST /x k1', 'fp', 60)).resolves.toEqual({ outcome: 'in-progress' });
  });

  it('replays a completed record with a matching fingerprint', async () => {
    const fake = new FakeRedis();
    const store = new RedisIdempotencyStore(asRedis(fake));
    await store.begin('POST /x k1', 'fp', 60);
    await store.complete('POST /x k1', 'fp', 201, { data: { id: 'u1' } }, 86_400);

    await expect(store.begin('POST /x k1', 'fp', 60)).resolves.toEqual({
      outcome: 'replay',
      status: 201,
      body: { data: { id: 'u1' } },
    });
  });

  it('reports a mismatch when the body differs', async () => {
    const fake = new FakeRedis();
    const store = new RedisIdempotencyStore(asRedis(fake));
    await store.begin('POST /x k1', 'fp-one', 60);
    await store.complete('POST /x k1', 'fp-one', 201, { data: {} }, 86_400);

    await expect(store.begin('POST /x k1', 'fp-two', 60)).resolves.toEqual({ outcome: 'mismatch' });
  });

  it('reports in-progress if the marker expires between claim and read', async () => {
    // The `SET NX` loses the race (returns null) but the follow-up read finds
    // nothing — the marker expired in between. The safe answer is "in progress"
    // so the caller retries rather than racing the request that owns the key.
    const expired = new RedisIdempotencyStore({
      withPrefix: (key: string) => `test:${key}`,
      raw: { set: async (): Promise<null> => null },
      getJson: async <T>(): Promise<T | null> => null,
    } as unknown as RedisService);

    await expect(expired.begin('POST /x k2', 'fp', 60)).resolves.toEqual({
      outcome: 'in-progress',
    });
  });

  it('fails open when Redis is unreachable', async () => {
    const fake = new FakeRedis();
    fake.failCommands = true;
    const store = new RedisIdempotencyStore(asRedis(fake));

    await expect(store.begin('POST /x k1', 'fp', 60)).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('does not throw when completing or releasing against a down Redis', async () => {
    const fake = new FakeRedis();
    fake.failCommands = true;
    const store = new RedisIdempotencyStore(asRedis(fake));

    await expect(store.complete('POST /x k1', 'fp', 200, {}, 60)).resolves.toBeUndefined();
    await expect(store.release('POST /x k1')).resolves.toBeUndefined();
  });

  it('writes an in-flight marker before the response exists', async () => {
    const fake = new FakeRedis();
    const store = new RedisIdempotencyStore(asRedis(fake));
    await store.begin('POST /x k1', 'fp', 60);

    const record = await fake.getJson<IdempotencyRecord>(idempotencyKey('POST /x k1'));
    expect(record).toMatchObject({ state: 'in-flight', fingerprint: 'fp' });
  });
});

import { Injectable, Logger } from '@nestjs/common';

import type { RateLimitDecision, RateLimiter } from '../../common/ports/rate-limiter.port';
import { randomToken } from '../../common/utils/crypto.util';
import { RedisService } from './redis.service';

/**
 * Sliding-window rate limiter backed by a Redis sorted set.
 *
 * ## Why sliding and not fixed
 *
 * A fixed window ("300 per minute, reset on the minute") lets a caller send 300
 * requests at 12:00:59 and another 300 at 12:01:00 — 600 requests in two
 * seconds, against a limit documented as 300 per minute. The window boundary is
 * a free burst. A sliding window scores each request by its own timestamp and
 * evicts anything older than `now - window`, so the limit holds at every instant
 * rather than on average.
 *
 * ## Why the whole thing is one script
 *
 * Read-then-write is the bug this design exists to avoid. Between a `ZCARD` and
 * a subsequent `ZADD`, another request can do the same, and both see room. Redis
 * executes a Lua script atomically, so the trim, the count, the insert and the
 * TTL refresh form one indivisible operation — and `EVAL` is safe to run against
 * a cluster replica set for reads while the script itself is a write.
 *
 * ## Cost
 *
 * Memory is bounded by `max` members per key, because the trim removes everything
 * outside the window and the key expires with it. There is no unbounded growth
 * from a persistent attacker.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]

-- Drop everything that has aged out of the window.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)

local count = redis.call('ZCARD', key)
local allowed = 0

if count < max then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end

-- Refresh the TTL so an idle key does not linger, and an active one does not
-- expire mid-window and hand the caller a fresh budget.
redis.call('PEXPIRE', key, windowMs)

-- Time until the oldest surviving request leaves the window: the earliest
-- moment the caller could succeed again. Sent as Retry-After.
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAfterSeconds = math.ceil(windowMs / 1000)
if oldest[2] then
  resetAfterSeconds = math.ceil((tonumber(oldest[2]) + windowMs - now) / 1000)
end
if resetAfterSeconds < 0 then
  resetAfterSeconds = 0
end

return { allowed, max - count, max, resetAfterSeconds }
`;

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  private readonly logger = new Logger(RedisRateLimiter.name);

  constructor(private readonly redis: RedisService) {}

  async consume(key: string, max: number, windowSeconds: number): Promise<RateLimitDecision> {
    const windowMs = windowSeconds * 1_000;
    const now = Date.now();

    // Members must be unique, or two requests in the same millisecond collapse
    // into one sorted-set entry and the count under-reports — letting a burst
    // through exactly when the limiter matters most.
    const member = `${now}-${randomToken(6)}`;

    const result = await this.redis.evalScript(
      SLIDING_WINDOW_SCRIPT,
      [this.redis.withPrefix(key)],
      [now, windowMs, max, member],
    );

    if (!Array.isArray(result) || result.length < 4) {
      // The script contract was violated. Fail open with a permissive decision
      // rather than throwing: a malformed reply must not become an outage.
      this.logger.error('Rate limiter script returned an unexpected shape; allowing the request.');
      return { allowed: true, remaining: max, limit: max, resetAfterSeconds: windowSeconds };
    }

    return {
      allowed: Number(result[0]) === 1,
      remaining: Math.max(0, Number(result[1])),
      limit: Number(result[2]),
      resetAfterSeconds: Math.max(0, Number(result[3])),
    };
  }
}

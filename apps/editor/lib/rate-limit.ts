import type Redis from 'ioredis'
import { getRedis, warnRedisUnavailable } from './redis'

/**
 * A distributed, sliding-window rate limiter backed by Redis. The window is a
 * sorted set of request timestamps; a Lua script does the prune-count-insert
 * atomically so concurrent replicas share one limit instead of N separate ones.
 */

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  /** Seconds until the oldest request in the window ages out. */
  retryAfter: number
  /** Epoch ms when the window next frees a slot. */
  resetAt: number
}

// KEYS[1]: rate key. ARGV[1]: now (ms). ARGV[2]: window (ms). ARGV[3]: limit.
// ARGV[4]: unique member (so two requests in the same millisecond both count).
const SLIDING_WINDOW_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])

if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, count + 1, 0}
end

local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local oldestScore = tonumber(oldest[2]) or now
local retryAfter = math.ceil((oldestScore + window - now) / 1000)
if retryAfter < 1 then retryAfter = 1 end
redis.call('PEXPIRE', KEYS[1], window)
return {0, count, retryAfter}
`

/**
 * `null` when the limit is disabled — no Redis configured, or Redis is down.
 * A failed Redis must not reject traffic: the limiter is not a source of
 * downtime, it is a ceiling.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  redis: Redis | null = getRedis(),
): Promise<RateLimitResult | null> {
  if (limit <= 0) return null

  if (!redis) return null

  const now = Date.now()
  try {
    const reply = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(windowMs),
      String(limit),
      `${now}-${Math.random().toString(36).slice(2)}`,
    )) as [number, number, number]

    const [allowed, count, retryAfter] = reply
    return {
      allowed: allowed === 1,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfter,
      resetAt: now + retryAfter * 1000,
    }
  } catch (error) {
    warnRedisUnavailable(error)
    return null
  }
}

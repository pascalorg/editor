import { describe, expect, test } from 'bun:test'
import Redis from 'ioredis'
import { checkRateLimit } from './rate-limit'
import { __resetRedisForTests } from './redis'

/**
 * The Redis cases skip without `REDIS_URL`, the same gate the Postgres suite
 * uses. The counter lives in Redis, so two calls against one key are two
 * callers sharing one limit — the property the in-process `Map` could not have.
 */
const REDIS_URL = process.env.REDIS_URL

describe('checkRateLimit', () => {
  test('fails open (returns null) when Redis is not configured', async () => {
    __resetRedisForTests()
    const previous = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      expect(await checkRateLimit('any', 10, 60_000)).toBeNull()
    } finally {
      if (previous !== undefined) process.env.REDIS_URL = previous
    }
  })

  test('fails open (returns null) when Redis is unreachable', async () => {
    __resetRedisForTests()
    const previous = process.env.REDIS_URL
    process.env.REDIS_URL = 'redis://127.0.0.1:6399'
    try {
      expect(await checkRateLimit('down', 10, 60_000)).toBeNull()
    } finally {
      if (previous !== undefined) process.env.REDIS_URL = previous
      __resetRedisForTests()
    }
  })
})

if (REDIS_URL) {
  describe('checkRateLimit against Redis', () => {
    test('allows up to the limit, then denies with a retry window', async () => {
      const key = `rl-test-${Date.now()}`
      for (let i = 0; i < 3; i += 1) {
        expect((await checkRateLimit(key, 3, 60_000))?.allowed).toBe(true)
      }

      const denied = await checkRateLimit(key, 3, 60_000)
      expect(denied?.allowed).toBe(false)
      expect(denied?.remaining).toBe(0)
      expect(denied?.retryAfter).toBeGreaterThan(0)
      expect(denied?.resetAt).toBeGreaterThan(Date.now())
    })

    test('two instances (separate connections) share one limit', async () => {
      const key = `rl-shared-${Date.now()}`
      const instanceA = new Redis(REDIS_URL)
      const instanceB = new Redis(REDIS_URL)

      try {
        // Instance A burns the budget; instance B — a different connection —
        // must see the same exhausted key, not its own fresh counter.
        await checkRateLimit(key, 2, 60_000, instanceA)
        await checkRateLimit(key, 2, 60_000, instanceA)

        const third = await checkRateLimit(key, 2, 60_000, instanceB)
        expect(third?.allowed).toBe(false)
      } finally {
        await instanceA.quit()
        await instanceB.quit()
      }
    })
  })
}

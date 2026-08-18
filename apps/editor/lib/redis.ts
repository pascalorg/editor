import Redis from 'ioredis'

/**
 * Thin, lazily-created Redis client. Rate limiting is the first consumer;
 * presence, short-lived cache and the background queue will reuse it.
 *
 * Fail-open by construction: without `REDIS_URL` the client is `null`, and a
 * client that cannot reach Redis rejects commands quickly (`maxRetriesPerRequest:
 * 1`, no offline queue) instead of hanging. Callers treat an unavailable Redis
 * as "limit disabled", never as a request failure.
 */

let client: Redis | null = null
let warned = false

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  if (!client) {
    client = new Redis(url, {
      // Fail fast rather than hang or silently drop traffic: no command retry,
      // a bounded connect, and give up reconnecting after a few attempts so a
      // down Redis degrades to "limit disabled" quickly and stays that way.
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      commandTimeout: 500,
      retryStrategy: (times) => (times < 3 ? Math.min(times * 200, 1000) : null),
    })
    // Without a listener, an ioredis 'error' event (e.g. ECONNREFUSED) is
    // unhandled and crashes the process — the opposite of fail-open.
    client.on('error', (error) => {
      warnRedisUnavailable(error)
    })
  }

  return client
}

/** Log the first failure only — a down Redis must not spam every request. */
export function warnRedisUnavailable(error: unknown): void {
  if (warned) return
  warned = true
  console.warn('[redis] unavailable, rate limiting disabled:', error)
}

/** Test-only: drop the cached client so a fresh env is picked up. */
export function __resetRedisForTests(): void {
  client = null
  warned = false
}

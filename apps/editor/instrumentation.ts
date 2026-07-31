/**
 * Runs once per server process before any request. The scene store is lazy
 * and its first consumer is a page request, so a misconfigured or unreachable
 * database would otherwise keep the deploy looking healthy until someone
 * opens /scenes. Force the connection here instead: a bad deploy dies at
 * startup, where the host's log makes the reason obvious.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { getSceneStore } = await import('./lib/scene-store-server')
  try {
    const store = await getSceneStore()
    await store.list({ limit: 1 })
    console.log(`[digitaltwin:boot] scene store ready backend=${store.backend}`)
  } catch (err) {
    console.error('[digitaltwin:boot] scene store unavailable:', err)
    if (process.env.NODE_ENV === 'production') {
      process.exit(1)
    }
  }

  const { authAvailable, migrateAuth } = await import('./lib/auth/db')
  if (authAvailable()) {
    try {
      await migrateAuth()
      console.log('[digitaltwin:boot] auth tables ready')
    } catch (err) {
      console.error('[digitaltwin:boot] auth unavailable:', err)
      if (process.env.NODE_ENV === 'production') {
        process.exit(1)
      }
    }
  }
}

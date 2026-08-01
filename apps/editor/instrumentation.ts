/**
 * Runs once per server process before any request. The scene store is lazy
 * and its first consumer is a page request, so a misconfigured or unreachable
 * database would otherwise keep the deploy looking healthy until someone
 * opens /scenes. Force the connection here instead: a bad deploy dies at
 * startup, where the host's log makes the reason obvious.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Before anything reads configuration: a panel that forgets its variables on
  // redeploy would otherwise take the database down with it.
  const { loadEnvFiles } = await import('./lib/env-file')
  const files = loadEnvFiles()
  if (files.length > 0) {
    console.log(`[digitaltwin:boot] loaded env files: ${files.join(', ')}`)
  }

  const { getSceneStore } = await import('./lib/scene-store-server')
  try {
    const store = await getSceneStore()
    await store.list({ limit: 1 })
    console.log(`[digitaltwin:boot] scene store ready backend=${store.backend}`)
  } catch (err) {
    console.error(`[digitaltwin:boot] scene store unavailable: ${describeStartupError(err)}`)
    if (process.env.NODE_ENV === 'production') {
      process.exit(1)
    }
  }

  const { authAvailable, migrateAuth } = await import('./lib/auth/db')
  if (authAvailable()) {
    try {
      const { ensureConsoleSchema } = await import('./lib/auth/live-migrate')
      await ensureConsoleSchema()
      await migrateAuth()
      console.log('[digitaltwin:boot] auth tables ready')
      // Console sites become real scenes; the worker keeps them in step.
      const { startSiteSceneWorker } = await import('./lib/auth/site-scenes')
      startSiteSceneWorker()
    } catch (err) {
      console.error(`[digitaltwin:boot] auth unavailable: ${describeStartupError(err)}`)
      if (process.env.NODE_ENV === 'production') {
        process.exit(1)
      }
    }
  }
}

/**
 * A refused TCP connection reaches us as an `AggregateError` holding one error
 * per address the hostname resolved to — and its own `message` is empty, so
 * logging it prints a bare "AggregateError:" above a stack through minified
 * bundle chunks. That names neither the host, the port, nor the reason. Unwrap
 * it, and translate the driver's error codes into the misconfiguration each
 * one actually indicates.
 */
function describeStartupError(err: unknown): string {
  const parts: string[] = []
  for (const cause of flatten(err)) {
    const code = (cause as { code?: string }).code
    const message = cause.message || cause.name
    // Node's own connect errors already spell out the address; only add it
    // when the driver's message leaves it out.
    const address = addressOf(cause)
    const suffix = address && !message.includes(address) ? ` (${address})` : ''
    const hint = code && HINTS[code] ? ` — ${HINTS[code]}` : ''
    parts.push(`${message}${suffix}${hint}`)
  }
  return parts.length > 0 ? [...new Set(parts)].join('; ') : String(err)
}

/** An AggregateError's `errors`, or the error itself. */
function flatten(err: unknown): Error[] {
  if (err instanceof AggregateError && Array.isArray(err.errors)) {
    return err.errors.flatMap(flatten)
  }
  return err instanceof Error ? [err] : []
}

function addressOf(err: Error): string | undefined {
  const { address, port } = err as { address?: string; port?: number }
  if (!address) return undefined
  return port ? `${address}:${port}` : address
}

const HINTS: Record<string, string> = {
  ECONNREFUSED: 'nothing is listening there; check DIGITALTWIN_MYSQL_HOST and _PORT',
  ENOTFOUND: 'hostname does not resolve; check DIGITALTWIN_MYSQL_HOST',
  ETIMEDOUT: 'no route or a firewall dropped it; check DIGITALTWIN_MYSQL_HOST and _PORT',
  ER_ACCESS_DENIED_ERROR: 'check DIGITALTWIN_MYSQL_USER and DIGITALTWIN_MYSQL_PASSWORD',
  ER_ACCESS_DENIED_NO_PASSWORD_ERROR: 'check DIGITALTWIN_MYSQL_PASSWORD',
  ER_BAD_DB_ERROR: 'check DIGITALTWIN_MYSQL_DATABASE',
  ER_DBACCESS_DENIED_ERROR: 'the user has no rights on that database',
}

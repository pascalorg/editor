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
    reportStartupFailure('scene store', err)
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
      reportStartupFailure('auth', err)
    }
  }
}

/**
 * Log a boot failure, and decide whether it is worth dying over.
 *
 * Refusing to boot is right for a database that is absent, unreachable or
 * refusing the password: the deploy would otherwise look healthy and fail at
 * the first page, and the release workflow's smoke test depends on that
 * refusal.
 *
 * It is wrong for a database that works but will not let us change its schema.
 * Both boot paths self-migrate — the scene store on first use, the console from
 * its SQL files — so on 2026-08-12 a `CREATE command denied` (the provider had
 * revoked DDL after the database passed its size quota) exited the process,
 * the host restarted it, and the site served 503 in a loop. The tables were all
 * there; every query would have worked. Nothing was reachable, not even the
 * sign-in page, and nothing said why.
 *
 * So a schema-permission failure now stays a loud warning and boot continues.
 * The deployment degrades honestly: pages render, reads work, writes fail where
 * they fail, and `/api/health` reports the database state — which is a
 * diagnosis, where a restart loop is a silence.
 */
function reportStartupFailure(label: string, err: unknown): void {
  const detail = describeStartupError(err)

  if (isSchemaPermissionError(err)) {
    console.error(`[digitaltwin:boot] ${label} cannot migrate: ${detail}`)
    console.error(
      `[digitaltwin:boot] serving anyway — existing tables still work; /api/health reports the database`,
    )
    return
  }

  console.error(`[digitaltwin:boot] ${label} unavailable: ${detail}`)
  if (process.env.NODE_ENV === 'production') {
    process.exit(1)
  }
}

/**
 * True when the server let us in and then refused a DDL statement.
 *
 * Deliberately only `ER_TABLEACCESS_DENIED_ERROR` — the code behind "CREATE
 * command denied to user … for table …". `ER_ACCESS_DENIED_ERROR` (bad
 * credentials) and `ER_DBACCESS_DENIED_ERROR` (no rights on the database at
 * all) stay fatal: those describe a deployment that cannot read its own data,
 * which is exactly the case booting must refuse.
 */
export function isSchemaPermissionError(err: unknown): boolean {
  return flatten(err).some(
    (cause) => (cause as { code?: string }).code === 'ER_TABLEACCESS_DENIED_ERROR',
  )
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
  ER_TABLEACCESS_DENIED_ERROR:
    'the user may read but not change the schema — usually a size quota the provider answered by revoking DDL, or a grant that no longer covers this database',
}

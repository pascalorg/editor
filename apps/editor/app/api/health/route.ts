import { authAvailable } from '@/lib/auth/db'
import { getSceneStore } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

/**
 * Exercises the scene store so one curl verifies a deploy end to end: which
 * backend was selected and whether the database actually answers.
 *
 * `version` and `instanceId` come from upstream and answer a different
 * question — not "is it healthy" but "WHICH build is this". Without them the
 * only way to tell whether a deploy actually landed is to hunt for a visible
 * change in the UI and guess, which is exactly how an afternoon gets spent on
 * a fix that shipped an hour earlier.
 */
export async function GET() {
  const build = {
    version: process.env.PASCAL_RUNTIME_VERSION ?? null,
    instanceId: process.env.PASCAL_INSTANCE_ID ?? null,
  }

  try {
    const store = await getSceneStore()
    await store.list({ limit: 1 })
    return Response.json({
      status: 'ok',
      app: 'digitaltwin',
      backend: store.backend,
      db: 'ok',
      auth: authAvailable() ? 'ok' : 'disabled',
      ...build,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        app: 'digitaltwin',
        error: error instanceof Error ? error.message : String(error),
        // Reported on the failure path too: a deploy that cannot reach its
        // database is exactly when knowing which build is answering matters.
        ...build,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    )
  }
}

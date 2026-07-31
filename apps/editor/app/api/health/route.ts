import { authAvailable } from '@/lib/auth/db'
import { getSceneStore } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

/**
 * Exercises the scene store so one curl verifies a deploy end to end: which
 * backend was selected and whether the database actually answers.
 */
export async function GET() {
  try {
    const store = await getSceneStore()
    await store.list({ limit: 1 })
    return Response.json({
      status: 'ok',
      app: 'digitaltwin',
      backend: store.backend,
      db: 'ok',
      auth: authAvailable() ? 'ok' : 'disabled',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        app: 'digitaltwin',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    )
  }
}

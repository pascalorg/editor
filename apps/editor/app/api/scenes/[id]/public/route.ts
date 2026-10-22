import { sceneApiJson, validateRateLimit } from '@/lib/scene-api-security'
import { isSceneShared } from '@/lib/scene-sharing'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteParams) {
  const rateLimit = validateRateLimit(request)
  if (rateLimit) return rateLimit
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !(await isSceneShared(id)))
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  return sceneApiJson(request, {
    id,
    name: scene.name,
    graph: scene.graph,
    updatedAt: scene.updatedAt,
  })
}

import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { isSceneShared, setSceneShared } from '@/lib/scene-sharing'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }
const shareSchema = z.object({ shared: z.boolean() })

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  return sceneApiJson(request, { shared: await isSceneShared(id) })
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  const parsed = shareSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })

  const operations = await getSceneOperations()
  if (!(await operations.loadStoredScene(id)))
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  await setSceneShared(id, parsed.data.shared)
  return sceneApiJson(request, { shared: parsed.data.shared })
}

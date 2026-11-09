import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { readSceneThumbnail, sceneThumbnailUrl, writeSceneThumbnail } from '@/lib/scene-thumbnails'

export const dynamic = 'force-dynamic'

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024
type RouteParams = { params: Promise<{ id: string }> }

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'image/webp')
    return sceneApiJson(request, { error: 'invalid_content_type' }, { status: 415 })
  if (Number(request.headers.get('content-length')) > MAX_THUMBNAIL_BYTES)
    return sceneApiJson(request, { error: 'too_large' }, { status: 413 })

  const operations = await getSceneOperations()
  if (!(await operations.loadStoredScene(id)))
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body?.getReader()
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_THUMBNAIL_BYTES) {
          await reader.cancel()
          return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  const bytes = Buffer.concat(chunks, size)
  await writeSceneThumbnail(id, bytes)
  return sceneApiJson(request, { thumbnailUrl: await sceneThumbnailUrl(id) })
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request, { skipRateLimit: true })
  if (guard) return guard
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  const bytes = await readSceneThumbnail(id)
  if (!bytes) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  return withSceneApiHeaders(
    request,
    new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    }),
  )
}

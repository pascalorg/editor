import { DiskArtifactStore, resolveDefaultDatabasePath } from '@pascal-app/mcp/storage'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: { params: Promise<{ sha256: string }> }) {
  // A scene loads one artifact per scripted object; immutable reads stay outside the request budget.
  const guard = guardSceneApiRequest(request, { skipRateLimit: true })
  if (guard) return guard
  const { sha256 } = await params
  if (!/^[0-9a-f]{64}$/.test(sha256))
    return sceneApiJson(request, { error: 'invalid_hash' }, { status: 400 })
  const bytes = await new DiskArtifactStore(resolveDefaultDatabasePath()).read(sha256)
  if (!bytes) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  const glb = new TextDecoder().decode(bytes.subarray(0, 4)) === 'glTF'
  return withSceneApiHeaders(
    request,
    new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': glb ? 'model/gltf-binary' : 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    }),
  )
}

export async function PUT(request: Request, { params }: { params: Promise<{ sha256: string }> }) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { sha256 } = await params
  if (!/^[0-9a-f]{64}$/.test(sha256))
    return sceneApiJson(request, { error: 'invalid_hash' }, { status: 400 })
  const bytes = await request.arrayBuffer()
  try {
    await new DiskArtifactStore(resolveDefaultDatabasePath()).put(sha256, bytes)
  } catch (error) {
    if (error instanceof Error && error.message === 'Artifact hash mismatch') {
      return sceneApiJson(request, { error: 'hash_mismatch' }, { status: 400 })
    }
    throw error
  }
  return sceneApiJson(request, { sha256 })
}

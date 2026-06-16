import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  const extension = contentType.includes('image/webp')
    ? 'webp'
    : contentType.includes('image/jpeg') || contentType.includes('image/jpg')
      ? 'jpg'
      : contentType.includes('image/png')
        ? 'png'
        : null

  if (!extension) {
    return sceneApiJson(request, { error: 'unsupported_thumbnail_type' }, { status: 415 })
  }

  const bytes = Buffer.from(await request.arrayBuffer())
  if (bytes.length === 0) {
    return sceneApiJson(request, { error: 'empty_thumbnail' }, { status: 400 })
  }
  if (bytes.length > MAX_THUMBNAIL_BYTES) {
    return sceneApiJson(request, { error: 'thumbnail_too_large' }, { status: 413 })
  }

  const operations = await getSceneOperations()
  const existing = await operations.loadStoredScene(id)
  if (!existing) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const publicDir = resolveEditorPublicDir()
  const thumbnailDir = path.join(publicDir, 'scene-thumbnails')
  await mkdir(thumbnailDir, { recursive: true })
  await writeFile(path.join(thumbnailDir, `${safeId}.${extension}`), bytes)

  const thumbnailUrl = `/scene-thumbnails/${safeId}.${extension}?v=${Date.now()}`
  const meta = await operations.saveScene({
    id,
    name: existing.name,
    projectId: existing.projectId,
    ownerId: existing.ownerId,
    graph: existing.graph as never,
    thumbnailUrl,
    expectedVersion: existing.version,
  })

  return sceneApiJson(request, { thumbnailUrl: meta.thumbnailUrl, version: meta.version })
}

function resolveEditorPublicDir(): string {
  const cwd = process.cwd()
  if (cwd.endsWith(`${path.sep}apps${path.sep}editor`)) {
    return path.join(cwd, 'public')
  }
  return path.join(cwd, 'apps', 'editor', 'public')
}

// Server-side only — Node.js APIs allowed.
import { type NextRequest, NextResponse } from 'next/server'
import type { MergeResult } from '@pascal-app/core/importers'
import type { CoordsJSON } from '@pascal-app/core/importers'
import { guardSceneApiRequest, sceneApiPreflight } from '@/lib/scene-api-security'
import { buildAndSaveScene } from '@/lib/dxf-scene-builder'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  let body: {
    name?: string
    mergeResult: MergeResult
    coords: CoordsJSON
    guideImageUrl?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.mergeResult || !body.coords) {
    return NextResponse.json({ error: 'mergeResult and coords are required' }, { status: 400 })
  }

  const result = await buildAndSaveScene(body.mergeResult, body.coords, {
    name:          body.name,
    guideImageUrl: body.guideImageUrl,
  })

  return NextResponse.json(result)
}

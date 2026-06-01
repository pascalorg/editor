import type { AssetInput } from '@pascal-app/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  findRepoRoot,
  generatedManifestPath,
  isRecord,
  readGeneratedAssets,
  upsertGeneratedAsset,
} from '@/lib/generated-assets/manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const repoRoot = await findRepoRoot()
  const assets = await readGeneratedAssets(generatedManifestPath(repoRoot))
  return NextResponse.json({ assets })
}

function isAssetInput(value: unknown): value is AssetInput & { id: string; source: 'mine' } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.src === 'string' &&
    typeof value.thumbnail === 'string'
  )
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const asset = isRecord(body) ? body.asset : null
  if (!isAssetInput(asset)) {
    return NextResponse.json({ error: 'asset is required' }, { status: 400 })
  }

  const repoRoot = await findRepoRoot()
  const savedAsset: AssetInput & { id: string; source: 'mine' } = {
    ...asset,
    source: 'mine',
  }
  await upsertGeneratedAsset(generatedManifestPath(repoRoot), savedAsset)

  return NextResponse.json({ asset: savedAsset, savedAt: new Date().toISOString() })
}

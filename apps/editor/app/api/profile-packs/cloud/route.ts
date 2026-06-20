import { NextResponse } from 'next/server'
import {
  installCloudProfilePack,
  listCloudProfilePackCatalog,
  listInstalledProfilePacks,
} from '@/lib/profile-packs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function GET() {
  const catalog = await listCloudProfilePackCatalog()
  return NextResponse.json({ packs: catalog.packs, catalog })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!isRecord(body) || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id_required' }, { status: 400 })
  }

  try {
    const result = await installCloudProfilePack(
      body.id,
      typeof body.version === 'string' ? body.version : undefined,
    )
    const packs = await listInstalledProfilePacks()
    const catalog = await listCloudProfilePackCatalog()
    return NextResponse.json({ ok: true, ...result, packs, cloudPacks: catalog.packs, catalog })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: 'cloud_profile_pack_install_failed', message },
      { status: 400 },
    )
  }
}

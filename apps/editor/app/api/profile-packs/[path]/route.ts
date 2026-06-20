import { NextResponse } from 'next/server'
import {
  listInstalledProfilePacks,
  removeProfilePack,
  setProfilePackEnabled,
} from '@/lib/profile-packs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ path: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { path } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const enabled =
    typeof body === 'object' &&
    body !== null &&
    'enabled' in body &&
    typeof body.enabled === 'boolean'
      ? body.enabled
      : undefined
  if (enabled == null) {
    return NextResponse.json({ error: 'enabled_boolean_required' }, { status: 400 })
  }

  try {
    const pack = await setProfilePackEnabled(decodeURIComponent(path), enabled)
    const packs = await listInstalledProfilePacks()
    return NextResponse.json({ ok: true, pack, packs })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'profile_pack_update_failed', message }, { status: 400 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { path } = await params
  try {
    await removeProfilePack(decodeURIComponent(path))
    const packs = await listInstalledProfilePacks()
    return NextResponse.json({ ok: true, packs })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'profile_pack_delete_failed', message }, { status: 400 })
  }
}

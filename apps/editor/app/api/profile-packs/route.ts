import { NextResponse } from 'next/server'
import { loadDeviceProfiles } from '@/lib/device-profiles'
import { installProfilePackZip, listInstalledProfilePacks } from '@/lib/profile-packs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PROFILE_PACK_BYTES = 8 * 1024 * 1024
const PROFILE_PACK_CACHE_TTL_MS = 60_000

type ProfilePackResponsePayload = Awaited<ReturnType<typeof buildProfilePackResponse>>

let cachedProfilePackResponse:
  | {
      expiresAt: number
      promise: Promise<ProfilePackResponsePayload>
    }
  | undefined

export async function GET() {
  const now = Date.now()
  if (!cachedProfilePackResponse || cachedProfilePackResponse.expiresAt <= now) {
    cachedProfilePackResponse = {
      expiresAt: now + PROFILE_PACK_CACHE_TTL_MS,
      promise: buildProfilePackResponse(),
    }
  }
  return NextResponse.json(await cachedProfilePackResponse.promise)
}

async function buildProfilePackResponse() {
  const [packs, loadedProfiles] = await Promise.all([
    listInstalledProfilePacks(),
    loadDeviceProfiles(),
  ])
  const profileDebug = loadedProfiles.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    source: profile.source,
    sourcePack: profile.sourcePack,
    family: profile.family,
    layoutFamily: profile.layoutFamily,
    primarySemanticRole: profile.primarySemanticRole,
    partCount: profile.parts.length,
    overrides: profile.overrides ?? [],
  }))
  const conflicts = profileDebug
    .filter((profile) => profile.overrides.length > 0)
    .map((profile) => ({
      id: profile.id,
      winner: {
        source: profile.source,
        sourcePack: profile.sourcePack,
      },
      overridden: profile.overrides,
    }))
  return {
    packs,
    profileDebug,
    conflicts,
    warnings: loadedProfiles.warnings,
    summary: {
      enabledCount: packs.filter((pack) => pack.enabled).length,
      profileCount: packs
        .filter((pack) => pack.enabled)
        .reduce((sum, pack) => sum + pack.profileCount, 0),
      loadedProfileCount: profileDebug.length,
      conflictCount: conflicts.length,
    },
  }
}

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }
  if (!/\.zip$/i.test(file.name)) {
    return NextResponse.json({ error: 'zip_required' }, { status: 400 })
  }
  if (file.size > MAX_PROFILE_PACK_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 })
  }

  try {
    const result = await installProfilePackZip(Buffer.from(await file.arrayBuffer()))
    cachedProfilePackResponse = undefined
    const packs = await listInstalledProfilePacks()
    return NextResponse.json({ ok: true, ...result, packs })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'invalid_profile_pack', message }, { status: 400 })
  }
}

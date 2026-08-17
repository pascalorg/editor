import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { listUsers, ownerEmails } from '@/lib/auth/admin'
import { authAvailable } from '@/lib/auth/db'
import { getSessionUser } from '@/lib/auth/session'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const putSchema = z.object({
  shares: z
    .array(
      z.object({
        userId: z.string().min(1).max(64),
        role: z.enum(['viewer', 'editor']),
      }),
    )
    .max(200),
})

type OwnerOrAdmin =
  | { ok: true; userId: string | null }
  | { ok: false; status: 401 | 403; error: string }

/**
 * A scene's sharing is managed by the account that owns it, or by any admin —
 * the same "admins + project owner" rule the product asks for. With auth off
 * (SQLite dev) there is no identity, so it stays open for local testing.
 */
async function authorizeOwnerOrAdmin(ownerId: string | null): Promise<OwnerOrAdmin> {
  if (!authAvailable()) return { ok: true, userId: null }
  const user = await getSessionUser()
  if (!user) return { ok: false, status: 401, error: 'auth_required' }
  if (user.role === 'admin' || (ownerId && ownerId === user.id)) {
    return { ok: true, userId: user.id }
  }
  return { ok: false, status: 403, error: 'forbidden' }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canShareScenes) {
    return sceneApiJson(request, { error: 'sharing_unavailable' }, { status: 501 })
  }
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const access = await authorizeOwnerOrAdmin(scene.ownerId ?? null)
  if (!access.ok) return sceneApiJson(request, { error: access.error }, { status: access.status })

  const [shares, users] = await Promise.all([operations.listSceneShares(id), listUsers()])
  const emails = await ownerEmails(shares.map((s) => s.userId))
  return sceneApiJson(request, {
    shares: shares.map((s) => ({
      userId: s.userId,
      role: s.role,
      email: emails.get(s.userId) ?? null,
    })),
    // Candidate accounts to share with — the owner is excluded (they already
    // have full access); everyone else is listed so an admin managing someone
    // else's scene, or the owner, can pick from the full roster.
    users: users.filter((u) => u.id !== scene.ownerId).map((u) => ({ id: u.id, email: u.email })),
    ownerId: scene.ownerId ?? null,
  })
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canShareScenes) {
    return sceneApiJson(request, { error: 'sharing_unavailable' }, { status: 501 })
  }
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const access = await authorizeOwnerOrAdmin(scene.ownerId ?? null)
  if (!access.ok) return sceneApiJson(request, { error: access.error }, { status: access.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  // Only real accounts, never the owner (owning already grants full access),
  // and one entry per user (last role wins) so a duplicated pick can't split.
  const validIds = new Set((await listUsers()).map((u) => u.id))
  const byUser = new Map<string, 'viewer' | 'editor'>()
  for (const s of parsed.data.shares) {
    if (!validIds.has(s.userId) || s.userId === scene.ownerId) continue
    byUser.set(s.userId, s.role)
  }
  const shares = [...byUser].map(([userId, role]) => ({ userId, role }))

  await operations.setSceneShares(id, shares, access.userId)
  return sceneApiJson(request, { ok: true, shares })
}

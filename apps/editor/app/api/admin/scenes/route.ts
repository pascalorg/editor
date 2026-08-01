import type { NextRequest } from 'next/server'
import { listUsers, ownerEmails, requireAdmin } from '@/lib/auth/admin'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/scenes — every scene with its owner, plus the accounts an
 * owner can be reassigned to. Feeds the console's 3D scenes tab, which took
 * over from the editor's old /admin page.
 */
export async function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const admin = await requireAdmin()
  if (!admin) return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })

  const [users, operations] = await Promise.all([listUsers(), getSceneOperations()])
  const scenes = await operations.listScenes({ limit: 500 })
  const emails = await ownerEmails(scenes.map((s) => s.ownerId).filter((x): x is string => !!x))

  return sceneApiJson(request, {
    scenes: scenes.map((s) => ({
      id: s.id,
      name: s.name,
      ownerId: s.ownerId,
      ownerEmail: s.ownerId ? (emails.get(s.ownerId) ?? null) : null,
      updatedAt: s.updatedAt,
      nodeCount: s.nodeCount,
    })),
    users: users.map((u) => ({ id: u.id, email: u.email })),
    adminId: admin.id,
  })
}

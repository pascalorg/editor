import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authAvailable } from '@/lib/auth/db'
import { authorizeSceneMutation } from '@/lib/auth/guard'
import { getSessionUser } from '@/lib/auth/session'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const postSchema = z.object({
  // The client wants to hold the edit lease. Only honoured if the user also
  // has edit permission on the scene (owner / editor-share / admin-editor).
  claim: z.boolean().optional(),
  wantsEdit: z.boolean().optional(),
  transferToUserId: z.string().min(1).optional(),
})

/**
 * POST /api/scenes/[id]/presence — heartbeat + single-active-editor lease.
 *
 * The model: whoever opens an editable scene first holds the edit lease and
 * edits; anyone who opens it afterward while the first is still present is a
 * live viewer until the lease frees. Permission gates eligibility
 * (`authorizeSceneMutation`); the lease decides who among the eligible edits
 * right now. With auth off (SQLite dev) there is no identity, so the caller is
 * simply reported as the editor and nothing is tracked.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params

  if (!authAvailable()) {
    return sceneApiJson(request, { isEditor: true, canEdit: true, editor: null, present: [] })
  }

  const user = await getSessionUser()
  if (!user) return sceneApiJson(request, { error: 'auth_required' }, { status: 401 })

  const operations = await getSceneOperations()
  if (!operations.canTrackPresence) {
    // Presence unsupported by this store — degrade to "you may edit if your
    // role allows", so the editor still works, just without the lease.
    const auth = await authorizeSceneMutation(id, null)
    return sceneApiJson(request, {
      isEditor: auth.ok,
      canEdit: auth.ok,
      editor: null,
      present: [],
    })
  }

  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // An empty/na body is fine — a bare heartbeat with no claim.
  }
  const parsed = postSchema.safeParse(body)
  const wantsClaim = parsed.success
    ? parsed.data.claim === true || parsed.data.wantsEdit === true
    : false
  const transferToUserId = parsed.success ? parsed.data.transferToUserId : undefined

  // Edit permission for THIS scene (owner / editor-share / admin+editor-role).
  const canEdit = (await authorizeSceneMutation(id, scene.ownerId ?? null)).ok

  let claim: { isEditor: boolean; editorUserId: string | null; editorEmail: string | null }
  if (transferToUserId) {
    if (canEdit && typeof operations.transferPresenceEditor === 'function') {
      claim = await operations.transferPresenceEditor(id, user.id, transferToUserId)
    } else {
      claim = await operations.touchScenePresence(id, user.id, user.email ?? null, {
        claimEditor: false,
      })
    }
  } else {
    claim = await operations.touchScenePresence(id, user.id, user.email ?? null, {
      claimEditor: wantsClaim && canEdit,
    })
  }
  const present = await operations.listScenePresence(id)

  return sceneApiJson(request, {
    isEditor: claim.isEditor,
    canEdit,
    editor: claim.editorUserId ? { userId: claim.editorUserId, email: claim.editorEmail } : null,
    present,
  })
}

/** DELETE — release the caller's presence on leave (best-effort). */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  if (!authAvailable()) return sceneApiJson(request, { ok: true })

  const user = await getSessionUser()
  if (!user) return sceneApiJson(request, { ok: true })

  const operations = await getSceneOperations()
  if (operations.canTrackPresence) {
    await operations.releaseScenePresence(id, user.id)
  }
  return sceneApiJson(request, { ok: true })
}

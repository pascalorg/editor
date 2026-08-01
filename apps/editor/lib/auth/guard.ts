import { authAvailable } from './db'
import { canEdit, getSessionUser, type SessionUser } from './session'

export type MutationAuth =
  | { ok: true; user: SessionUser | null }
  | { ok: false; status: 401 | 403; error: string }

/**
 * Authorizes a write against an existing scene.
 *
 * - Auth off (SQLite dev): always allowed, no identity.
 * - Signed out: 401.
 * - View-only account: 403 — a viewer opens scenes in preview and never
 *   writes, whatever the ownership says.
 * - Owned by someone else and caller is not an admin: 403.
 * - Unowned (legacy null-owner scenes) or owned by the caller: allowed. An
 *   admin may write any scene.
 */
/**
 * Authorizes a read of one scene.
 *
 * `GET /api/scenes/:id` had no identity check at all: the surrounding guard
 * proves the request came from this origin, not that it came from anybody in
 * particular, so any visitor holding a scene id could read the drawing —
 * while `/scene/:id`, the page rendering the same data, redirected them to
 * sign in. The rule here is the one `GET /api/scenes` already applies to the
 * list: you see your own, an admin sees all.
 *
 * Published scenes are the deliberate exception. Publishing is an
 * administrator approving a project for the whole organisation, and the
 * signed-in scene list, the sign-in showcase and Sites & Projects all render
 * them — so any signed-in account may read one, whoever owns it.
 */
export async function authorizeSceneRead(
  ownerId: string | null,
  opts: { published?: boolean } = {},
): Promise<MutationAuth> {
  if (!authAvailable()) return { ok: true, user: null }
  const user = await getSessionUser()
  if (!user) return { ok: false, status: 401, error: 'auth_required' }
  if (user.role === 'admin') return { ok: true, user }
  if (opts.published) return { ok: true, user }
  if (ownerId && ownerId !== user.id) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true, user }
}

export async function authorizeSceneMutation(ownerId: string | null): Promise<MutationAuth> {
  if (!authAvailable()) return { ok: true, user: null }
  const user = await getSessionUser()
  if (!user) return { ok: false, status: 401, error: 'auth_required' }
  if (!canEdit(user)) return { ok: false, status: 403, error: 'forbidden' }
  if (ownerId && ownerId !== user.id && user.role !== 'admin') {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  return { ok: true, user }
}

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

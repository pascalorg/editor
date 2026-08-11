import { getSession } from '@panel/lib/auth/session'
import type { SceneGraph } from '@pascal-app/editor'
import { redirect } from 'next/navigation'
import { SceneLoader, type SceneMeta } from '@/components/scene-loader'
import { canEdit, getSessionUser } from '@/lib/auth/session'
import { getSceneOperations } from '@/lib/scene-store-server'
import { loadOrCreateWorkspaceScene } from '@/lib/workspace-scene'

export const dynamic = 'force-dynamic'

/**
 * The front door. A visitor who has not finished signing in is sent to the
 * console screen that matches their state; a signed-in one gets the editor
 * rendered right here — no redirect, so the address bar stays on the bare
 * domain, which is how the operator wants the editor addressed.
 *
 * **It renders `<SceneLoader>`, not a bare `<Editor>`, and that is the whole
 * point of this route.** A bare `<Editor>` has no `onSave`, and the editor's
 * fallback in that case is `localStorage` — so the front door used to draw
 * warehouses into one browser profile and never touch the database. Going
 * through `SceneLoader` puts it on the same path as `/scene/[id]`: `PUT
 * /api/scenes/[id]`, `If-Match` version checks, conflict handling and the live
 * event stream, all for free. See `lib/workspace-scene.ts` for why the row is
 * found by `projectId` rather than by name.
 */
export default async function Root() {
  const session = await getSession({ touch: false })

  if (!session) redirect('/signin')
  if (session.mfaPending) redirect('/mfa')
  if (session.user.mustChangePassword) redirect('/welcome')

  // View-only accounts have no business in the editing surface: they land on
  // their scene list and open scenes in preview.
  const user = await getSessionUser()
  if (!user) redirect('/signin')
  if (!canEdit(user)) redirect('/scenes')

  const workspace = await loadOrCreateWorkspaceScene(user.id)

  // The row above carries metadata, not the graph. Loading it separately keeps
  // the create path from having to round-trip a graph it just wrote.
  const operations = await getSceneOperations()
  const loaded = (await operations.loadStoredScene(workspace.id)) as {
    graph?: SceneGraph
  } | null
  const graph = loaded?.graph ?? ({ nodes: {}, rootNodeIds: [] } as unknown as SceneGraph)

  return <SceneLoader initialScene={graph} meta={workspace as unknown as SceneMeta} />
}

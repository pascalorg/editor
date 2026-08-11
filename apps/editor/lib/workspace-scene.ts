import type { SceneMeta } from '@pascal-app/mcp/storage'
import { getSceneStore } from '@/lib/scene-store-server'

/**
 * The scene behind the bare domain.
 *
 * ## Why this file exists
 *
 * `/` renders the editor for a signed-in user, and until now that editor had no
 * save wired to it: `<Editor>` with no `onSave` falls back to
 * `saveSceneToLocalStorage` (`packages/editor/src/lib/scene.ts`). So every wall,
 * rack and level drawn at the front door lived in one browser profile and never
 * reached MySQL. Upstream has the same shape and answers it with a banner —
 * *"Blank canvas — saved scenes are under Scenes"* — because upstream is an
 * anonymous open-source app with no accounts and therefore no row to save into.
 *
 * **This fork has accounts.** The banner solves a constraint we do not have, so
 * instead of copying the warning we give the front door a real scene: one row
 * per user, created on first visit, saved through the same `PUT /api/scenes/[id]`
 * path every other scene uses. Nothing local, nothing lost on refresh, and no
 * warning needed because there is nothing to warn about.
 *
 * ## Why `projectId` and not a name
 *
 * A name is user-editable — rename the workspace and the next visit would
 * silently create a second one. `projectId` is not shown, not editable, and is
 * already a first-class filter on both `list` and `save`, so it is the only
 * field that can carry "this is the workspace" without the user being able to
 * break it by accident.
 */
export const WORKSPACE_PROJECT_ID = 'workspace'

/**
 * Same starting point the Scenes rail uses for "new scene".
 *
 * `rootNodeIds` is branded per node kind, so an empty literal needs the cast —
 * there is no id in it to infer a brand from.
 */
const EMPTY_GRAPH = { nodes: {}, rootNodeIds: [] } as unknown as Parameters<
  Awaited<ReturnType<typeof getSceneStore>>['save']
>[0]['graph']

const WORKSPACE_NAME = 'Çalışma alanı'

/**
 * This user's workspace scene, created if they have never opened one.
 *
 * `list` is filtered by owner AND project, so two users never see each other's
 * workspace and a user's ordinary scenes never match. The `limit: 1` is not an
 * optimisation: if a duplicate ever exists — two tabs opening the front door for
 * the very first time at the same moment — taking the first row deterministically
 * means both tabs converge on one scene instead of forking into two.
 */
export async function loadOrCreateWorkspaceScene(ownerId: string): Promise<SceneMeta> {
  const store = await getSceneStore()

  const existing = await store.list({ ownerId, projectId: WORKSPACE_PROJECT_ID, limit: 1 })
  const found = existing[0]
  if (found) return found

  return store.save({
    name: WORKSPACE_NAME,
    projectId: WORKSPACE_PROJECT_ID,
    ownerId,
    graph: EMPTY_GRAPH,
  })
}

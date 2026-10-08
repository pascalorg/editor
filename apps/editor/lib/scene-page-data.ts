import type { SceneMeta, SceneWithGraph } from '@pascal-app/mcp/storage'
import { getSceneOperations } from '@/lib/scene-store-server'

const SCENE_LIST_LIMIT = 50

/**
 * Scene reads for the server-rendered `/scenes` and `/scene/[id]` pages.
 *
 * They talk to the store directly because they already run in the process that
 * serves `/api/scenes`. Rendering used to `fetch()` the app's own HTTP API
 * through a base URL built from `NEXT_PUBLIC_APP_URL` or the forwarded `Host`
 * header, which made a page render depend on the deployment being able to
 * reach itself at its public URL *and* on passing the scene API's caller
 * authentication. Behind a reverse proxy that self-request arrived
 * non-loopback carrying neither `Origin` nor `Authorization`, so the API
 * answered 503 (or 401 once a token was configured) and the scene list
 * rendered empty while the scene page failed outright.
 */
export async function listScenesForPage(): Promise<SceneMeta[]> {
  const operations = await getSceneOperations()
  return operations.listScenes({ limit: SCENE_LIST_LIMIT })
}

export async function loadSceneForPage(id: string): Promise<SceneWithGraph | null> {
  const operations = await getSceneOperations()
  return operations.loadStoredScene(id)
}

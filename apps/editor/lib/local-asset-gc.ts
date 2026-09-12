import {
  collectNodeAssetUrls,
  collectSceneAssetUrls,
  sweepLocalAssetsExcept,
} from '@pascal-app/core'

const LOCAL_STORAGE_SCENE_KEY = 'pascal-editor-scene'
/** Must match apps/editor/app/api/scenes/route.ts listQuerySchema max. */
const SCENES_LIST_MAX = 500

type SceneGraphLike = {
  nodes?: Record<string, unknown>
}

function collectGraphAssetUrls(graph: SceneGraphLike | null | undefined): string[] {
  if (!graph?.nodes) return []
  return collectSceneAssetUrls(graph.nodes as never)
}

/** Asset URLs still referenced by the browser's localStorage scene, if any. */
export function collectLocalStorageSceneAssetUrls(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SCENE_KEY)
    if (!raw) return []
    return collectGraphAssetUrls(JSON.parse(raw) as SceneGraphLike)
  } catch {
    return []
  }
}

/**
 * Union of asset URLs across every graph this origin can still open.
 * Returns null when the inventory cannot be proven complete — callers must
 * skip GC rather than sweep from a partial keep-set.
 */
export async function collectAllPersistedAssetUrls(
  currentNodes: Record<string, unknown>,
): Promise<string[] | null> {
  const keep = new Set<string>(collectSceneAssetUrls(currentNodes as never))
  for (const url of collectLocalStorageSceneAssetUrls()) keep.add(url)

  // Server-side scenes may share the same asset:// handles after duplication.
  // If listing fails or is truncated we cannot prove the keep-set is complete.
  let scenesJson: { data?: { scenes?: unknown[] }; scenes?: unknown[] } | null = null
  try {
    const res = await fetch(`/api/scenes?limit=${SCENES_LIST_MAX}`)
    if (!res.ok) return null
    scenesJson = (await res.json()) as typeof scenesJson
  } catch {
    return null
  }

  const list = (scenesJson?.data?.scenes ?? scenesJson?.scenes ?? []) as Array<{
    id?: unknown
  }>
  // The API has no cursor/total. A full page means older scenes were dropped
  // by `limit` — treating it as complete would delete their Files.
  if (list.length >= SCENES_LIST_MAX) return null

  for (const entry of list) {
    const id = entry?.id
    if (typeof id !== 'string' || !id) continue
    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`)
      if (!res.ok) return null
      const body = (await res.json()) as {
        data?: { graph?: SceneGraphLike; scene?: { graph?: SceneGraphLike } }
        graph?: SceneGraphLike
      }
      const graph = body.data?.graph ?? body.data?.scene?.graph ?? body.graph ?? null
      for (const url of collectGraphAssetUrls(graph)) keep.add(url)
    } catch {
      return null
    }
  }

  return [...keep]
}

/**
 * Explicit GC: delete IndexedDB Files that no persisted scene references.
 *
 * `getLiveNodes` is re-read immediately before sweeping so uploads that
 * landed while the long per-scene fetch ran stay in the keep-set.
 * No-ops when the full keep-set cannot be built (never partial-sweeps).
 */
export async function runLocalAssetGc(
  getLiveNodes: () => Record<string, unknown>,
  extraKeepUrls: Iterable<string> = [],
): Promise<number | null> {
  const keep = await collectAllPersistedAssetUrls(getLiveNodes())
  if (keep === null) return null

  const finalKeep = new Set<string>(keep)
  for (const url of collectSceneAssetUrls(getLiveNodes() as never)) {
    finalKeep.add(url)
  }
  for (const url of extraKeepUrls) {
    if (typeof url === 'string' && url.startsWith('asset://')) finalKeep.add(url)
  }
  return sweepLocalAssetsExcept(finalKeep)
}

/** For tests: collect urls from an arbitrary node map. */
export function collectNodeAssetUrlList(nodes: Record<string, unknown>): string[] {
  const urls: string[] = []
  for (const node of Object.values(nodes)) {
    urls.push(...collectNodeAssetUrls(node as never))
  }
  return urls
}

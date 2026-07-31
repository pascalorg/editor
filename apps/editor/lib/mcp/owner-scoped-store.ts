import { SceneNotFoundError } from '@pascal-app/mcp/storage'
import type {
  SceneEvent,
  SceneEventAppendOptions,
  SceneEventListOptions,
  SceneId,
  SceneListOptions,
  SceneMeta,
  SceneMutateOptions,
  SceneSaveOptions,
  SceneStore,
  SceneWithGraph,
} from '@pascal-app/mcp/storage/types'

/**
 * Wraps the scene store so an agent acts as one person rather than as nobody.
 *
 * The MCP tools have no notion of a user — left alone they write scenes with
 * no owner, which appear in nobody's list yet can be opened and changed by
 * anyone holding the link. This binds every call to the user whose token
 * authenticated the request: writes are stamped with their id, reads and lists
 * are confined to what they own, and someone else's scene is reported missing
 * rather than refused, so an agent cannot probe for scenes it may not touch.
 *
 * An admin is deliberately not given a bypass here. Admins can already reach
 * every scene through the panel; letting an agent inherit that would mean a
 * single leaked token edits the whole installation.
 */
export function ownerScopedStore(store: SceneStore, ownerId: string): SceneStore {
  const ownsOrMissing = async (id: SceneId): Promise<SceneWithGraph> => {
    const scene = await store.load(id)
    // Same error for absent and not-yours: a different message would let an
    // agent enumerate which scene ids exist.
    if (!scene || (scene.ownerId != null && scene.ownerId !== ownerId)) {
      throw new SceneNotFoundError()
    }
    return scene
  }

  const scoped: SceneStore = {
    backend: store.backend,

    save(opts: SceneSaveOptions): Promise<SceneMeta> {
      return store.save({ ...opts, ownerId })
    },

    async load(id: SceneId): Promise<SceneWithGraph | null> {
      const scene = await store.load(id)
      if (!scene) return null
      if (scene.ownerId != null && scene.ownerId !== ownerId) return null
      return scene
    },

    list(opts?: SceneListOptions): Promise<SceneMeta[]> {
      return store.list({ ...opts, ownerId })
    },

    async delete(id: SceneId, opts?: SceneMutateOptions): Promise<boolean> {
      await ownsOrMissing(id)
      return store.delete(id, opts)
    },

    async rename(id: SceneId, newName: string, opts?: SceneMutateOptions): Promise<SceneMeta> {
      await ownsOrMissing(id)
      return store.rename(id, newName, opts)
    },
  }

  // Optional members are forwarded only when the backend has them, so
  // `'createProject' in store` stays an honest capability check downstream.
  if (store.createProject) {
    scoped.createProject = (opts) =>
      store.createProject?.(opts) as ReturnType<NonNullable<SceneStore['createProject']>>
  }
  if (store.getProjectStatus) {
    scoped.getProjectStatus = (id) =>
      store.getProjectStatus?.(id) as ReturnType<NonNullable<SceneStore['getProjectStatus']>>
  }
  if (store.appendSceneEvent) {
    scoped.appendSceneEvent = async (opts: SceneEventAppendOptions): Promise<SceneEvent> => {
      await ownsOrMissing(opts.sceneId)
      return store.appendSceneEvent?.(opts) as Promise<SceneEvent>
    }
  }
  if (store.listSceneEvents) {
    scoped.listSceneEvents = async (
      sceneId: SceneId,
      opts?: SceneEventListOptions,
    ): Promise<SceneEvent[]> => {
      await ownsOrMissing(sceneId)
      return store.listSceneEvents?.(sceneId, opts) as Promise<SceneEvent[]>
    }
  }

  return scoped
}

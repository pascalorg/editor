// lib/scenegraph/store.ts

import { produce } from 'immer'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  type AnyNode,
  type AnyNodeId,
  type AnyNodeType,
  buildSceneGraphIndex,
  getNodeByPath,
  initScene,
  loadScene,
  type Scene,
  type SceneGraphIndex,
  type SceneNode,
  type SceneNodeId,
  updateNodeByPath,
} from './schema/index'

// IndexedDB storage setup (same as before)
const dbName = 'SceneGraphDB'
const storeName = 'sceneStore'

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      db.createObjectStore(storeName)
    }
  })
}

const indexedDBStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.get(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ? JSON.stringify(request.result) : null)
    })
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.put(JSON.parse(value), name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  },
  removeItem: async (name: string): Promise<void> => {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.delete(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  },
}

interface SceneState {
  scene: Scene | null
  sceneIndex: SceneGraphIndex | null
  init: () => void
  load: (data: unknown) => void
  setScene: (nextScene: Scene) => void
  updateNode: (id: SceneNodeId, updates: Partial<SceneNode>) => SceneNode | null
  deleteNode: (id: SceneNodeId) => void
  getNodeById: (id: SceneNodeId) => SceneNode | null
  listNodesByType: (type: AnyNodeType) => SceneNode[]
}

const buildIndex = (scene: Scene | null): SceneGraphIndex | null =>
  scene ? buildSceneGraphIndex(scene) : null
const defaultScene = initScene()
const defaultIndex = buildSceneGraphIndex(defaultScene)

const deleteNodeFromScene = (scene: Scene, path: (string | number)[]): Scene => {
  if (path.length === 0) {
    return scene
  }

  return produce(scene, (draft) => {
    let cursor: unknown = draft
    for (let i = 0; i < path.length - 1; i += 1) {
      if (typeof cursor !== 'object' || cursor === null) {
        return
      }

      const segment = path[i]
      if (Array.isArray(cursor) && typeof segment === 'number') {
        cursor = cursor[segment]
      } else if (!Array.isArray(cursor) && typeof segment === 'string') {
        cursor = (cursor as Record<string, unknown>)[segment]
      } else {
        return
      }
    }

    if (typeof cursor !== 'object' || cursor === null) {
      return
    }

    const container = cursor as Record<string, unknown> | unknown[]
    const lastKey = path[path.length - 1]

    if (Array.isArray(container) && typeof lastKey === 'number') {
      container.splice(lastKey, 1)
    } else if (!Array.isArray(container) && typeof lastKey === 'string') {
      delete container[lastKey]
    }
  })
}

const replaceScene = (set: (partial: Partial<SceneState>) => void, nextScene: Scene) => {
  set({
    scene: nextScene,
    sceneIndex: buildSceneGraphIndex(nextScene),
  })
}

export const useSceneStore = create<SceneState>()(
  persist(
    (set, get) => ({
      scene: defaultScene,
      sceneIndex: defaultIndex,
      init: () => {
        const nextScene = initScene()
        replaceScene(set, nextScene)
      },
      load: (data: unknown) => {
        const nextScene = loadScene(data)
        replaceScene(set, nextScene)
      },
      setScene: (nextScene: Scene) => {
        replaceScene(set, nextScene)
      },
      updateNode: (id, updates) => {
        const { scene, sceneIndex } = get()
        if (!scene) {
          return null
        }
        if (!sceneIndex) {
          return null
        }

        const meta = sceneIndex.byId.get(id)
        if (!meta) {
          return null
        }

        const updatedScene = updateNodeByPath(
          scene,
          meta.path,
          (node) =>
            ({
              ...node,
              ...updates,
            }) as SceneNode,
        ) as Scene

        replaceScene(set, updatedScene)
        return getNodeByPath(updatedScene, meta.path)
      },
      deleteNode: (id) => {
        const { scene, sceneIndex } = get()
        if (!scene) {
          return
        }
        if (!sceneIndex) {
          return
        }

        const meta = sceneIndex.byId.get(id)
        if (!meta) {
          return
        }

        const updatedScene = deleteNodeFromScene(scene, meta.path)
        replaceScene(set, updatedScene)
      },
      getNodeById: (id) => {
        const { scene, sceneIndex } = get()
        if (!scene) {
          return null
        }
        if (!sceneIndex) {
          return null
        }

        const meta = sceneIndex.byId.get(id)
        if (!meta) {
          return null
        }

        return getNodeByPath(scene, meta.path)
      },
      listNodesByType: (type) => {
        const { scene, sceneIndex } = get()
        if (!scene) {
          return []
        }
        if (!sceneIndex) {
          return []
        }

        const ids = sceneIndex.byType.get(type)
        if (!ids) {
          return []
        }

        const nodes: SceneNode[] = []
        ids.forEach((nodeId) => {
          const meta = sceneIndex.byId.get(nodeId)
          if (!meta) {
            return
          }
          const node = getNodeByPath(scene, meta.path)
          if (node) {
            nodes.push(node)
          }
        })

        return nodes
      },
    }),
    {
      name: 'scenegraph-store',
      version: 1,
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => ({
        scene: state.scene,
      }),
      merge: (persisted, current) => {
        const incoming = persisted as Partial<SceneState>
        const scene = incoming.scene ?? current.scene
        return {
          ...current,
          ...incoming,
          scene,
          sceneIndex: buildIndex(scene ?? null),
        }
      },
    },
  ),
)

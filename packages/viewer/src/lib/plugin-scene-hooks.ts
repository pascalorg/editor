import { type SceneLoadContext, sceneHookRegistry } from '@pascal-app/core'
import type { Object3D } from 'three'

// Loaded hook fns, cached by plugin id so the lazy module import happens once
// regardless of how many times a scene is (re-)decorated.
const loaded = new Map<string, (root: Object3D, ctx: SceneLoadContext) => void>()

/**
 * Run every plugin-contributed `onSceneLoad` hook (see `sceneHookRegistry`)
 * against a scene subtree. Called for both the live editor scene and each loaded
 * baked GLB; hooks must be idempotent because it can fire repeatedly as content
 * changes. A throwing hook is isolated so one plugin can't break the scene.
 */
export async function applyPluginSceneHooks(root: Object3D, ctx: SceneLoadContext): Promise<void> {
  const entries = sceneHookRegistry.getSnapshot()
  if (entries.length === 0) return
  await Promise.all(
    entries.map(async (entry) => {
      let fn = loaded.get(entry.pluginId)
      if (!fn) {
        fn = (await entry.hook()).default
        loaded.set(entry.pluginId, fn)
      }
      try {
        fn(root, ctx)
      } catch (err) {
        console.error(`[plugin-scene-hooks] "${entry.pluginId}" onSceneLoad failed`, err)
      }
    }),
  )
}

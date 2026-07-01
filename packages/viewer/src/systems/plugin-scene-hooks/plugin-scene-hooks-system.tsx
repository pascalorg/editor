import { sceneHookRegistry, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useSyncExternalStore } from 'react'
import { applyPluginSceneHooks } from '../../lib/plugin-scene-hooks'
import useViewer from '../../store/use-viewer'

/**
 * Runs plugin `onSceneLoad` hooks against the live editor scene, re-applying
 * whenever the node set changes so a hook catches newly-added meshes. Idempotent
 * hooks keep the re-run cheap (they guard their own already-decorated work). The
 * baked `/viewer` path decorates loaded GLBs from `GlbScene` instead of here.
 */
export default function PluginSceneHooksSystem() {
  const scene = useThree((s) => s.scene)
  const nodes = useScene((s) => s.nodes)
  const isExporting = useViewer((s) => s.isExporting)
  const hooks = useSyncExternalStore(
    sceneHookRegistry.subscribe,
    sceneHookRegistry.getSnapshot,
    sceneHookRegistry.getSnapshot,
  )

  // `nodes` isn't read in the body — it's a trigger: re-run when the scene's node
  // set changes (add/remove/preset swap → new meshes/materials) so the idempotent
  // hooks decorate the newcomers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nodes` is an intentional re-run trigger, not read inside.
  useEffect(() => {
    if (hooks.length === 0) return
    void applyPluginSceneHooks(scene, { phase: 'live', isExporting })
  }, [scene, nodes, isExporting, hooks])

  return null
}

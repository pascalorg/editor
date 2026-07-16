'use client'

import {
  type AnyNodeDefinition,
  createSceneApi,
  isNodeKindEnabled,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { type ComponentType, lazy, Suspense, useMemo } from 'react'

const DEFAULT_PRIORITY = 5

// Cache lazy components keyed by the module-loader function so React.lazy
// isn't re-invoked across renders.
type RegisteredSystemProps = {
  sceneApi: ReturnType<typeof createSceneApi>
}

const lazyCache = new WeakMap<() => Promise<unknown>, ComponentType<RegisteredSystemProps>>()

function loadSystem(def: AnyNodeDefinition): ComponentType<RegisteredSystemProps> | null {
  if (!def.system) return null
  const cached = lazyCache.get(def.system.module)
  if (cached) return cached
  const Comp = lazy(def.system.module)
  lazyCache.set(def.system.module, Comp)
  return Comp
}

/**
 * Mounts every registered node kind's system component, ordered by
 * `system.priority` (default {@link DEFAULT_PRIORITY}).
 *
 * Today the registry is empty so this component mounts nothing — coexists
 * with legacy `*-System` components in `<Viewer>`. Once kinds register via
 * `@pascal-app/nodes`, each kind's registry-driven system takes over and
 * its legacy counterpart short-circuits via the `nodeRegistry.has(kind)`
 * guard added to each legacy system.
 */
export function RegisteredSystems() {
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const installedPlugins = useScene((state) => state.installedPlugins)
  const entries = useMemo(() => {
    return Array.from(nodeRegistry.entries())
      .filter(([, def]) => def.system != null)
      .sort(([, a], [, b]) => {
        const pa = a.system?.priority ?? DEFAULT_PRIORITY
        const pb = b.system?.priority ?? DEFAULT_PRIORITY
        return pa - pb
      })
  }, [])

  if (entries.length === 0) return null

  return (
    <Suspense fallback={null}>
      {entries.map(([kind, def]) => {
        if (!isNodeKindEnabled(kind, installedPlugins)) return null
        const Comp = loadSystem(def)
        if (!Comp) return null
        return <Comp key={`registered-system:${kind}`} sceneApi={sceneApi} />
      })}
    </Suspense>
  )
}

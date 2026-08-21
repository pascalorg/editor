'use client'

import {
  type AnyNodeDefinition,
  createSceneApi,
  isNodeKindEnabled,
  nodeRegistry,
  useRegistryVersion,
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
 * Two resilience rules, both learned from a live session in which the wall
 * systems bundle (geometry rebuild + cutout stamps + batching) never ran
 * while everything else did (QA f2 probe6: 24 walls stuck on placeholder
 * geometry, no `wallHidden` stamps, base materials untouched):
 *
 * 1. `entries` re-derives on `useRegistryVersion()` — kinds register
 *    asynchronously (plugin discovery, HMR), and a list snapshotted once at
 *    mount permanently drops any system whose kind registers later. Same
 *    staleness class SelectionManager already guards against ("plugin
 *    nodes select-but-never-hover").
 * 2. Each system gets its OWN Suspense boundary. With one shared boundary,
 *    ANY lazily-loading (or load-failing) system chunk unmounts every
 *    other system while it is pending — one bad chunk must not take the
 *    wall pipeline down with it.
 */
export function RegisteredSystems() {
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const installedPlugins = useScene((state) => state.installedPlugins)
  const registryVersion = useRegistryVersion()
  const entries = useMemo(() => {
    // re-derive when kinds register after mount (async plugin load)
    void registryVersion
    return Array.from(nodeRegistry.entries())
      .filter(([, def]) => def.system != null)
      .sort(([, a], [, b]) => {
        const pa = a.system?.priority ?? DEFAULT_PRIORITY
        const pb = b.system?.priority ?? DEFAULT_PRIORITY
        return pa - pb
      })
  }, [registryVersion])

  if (entries.length === 0) return null

  return (
    <>
      {entries.map(([kind, def]) => {
        if (!isNodeKindEnabled(kind, installedPlugins)) return null
        const Comp = loadSystem(def)
        if (!Comp) return null
        return (
          <Suspense fallback={null} key={`registered-system:${kind}`}>
            <Comp sceneApi={sceneApi} />
          </Suspense>
        )
      })}
    </>
  )
}

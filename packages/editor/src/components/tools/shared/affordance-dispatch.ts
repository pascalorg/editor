import { nodeRegistry } from '@pascal-app/core'
import { type ComponentType, lazy } from 'react'

/**
 * Phase 5 Stage D — runtime lazy-load of a kind's affordance tool.
 *
 * The editor can't statically import from `@pascal-app/nodes` (the
 * nodes package depends on editor — static imports would cycle). The
 * kind declares its drag-affordance components in
 * `def.affordanceTools[<key>]: () => import('./<name>-tool')`; this
 * helper resolves that to a `React.lazy` component at the call site.
 *
 * Returns null when the kind doesn't declare the affordance — callers
 * mount the legacy fallback in that case.
 */
const lazyToolCache = new WeakMap<() => Promise<unknown>, ComponentType>()

export function getRegistryAffordanceTool(
  kind: string,
  affordance: string,
): ComponentType<any> | null {
  const def = nodeRegistry.get(kind)
  const loader = def?.affordanceTools?.[affordance]
  if (!loader) return null
  const cached = lazyToolCache.get(loader)
  if (cached) return cached
  const Comp = lazy(loader as () => Promise<{ default: ComponentType<any> }>)
  lazyToolCache.set(loader, Comp as unknown as ComponentType)
  return Comp as unknown as ComponentType<any>
}

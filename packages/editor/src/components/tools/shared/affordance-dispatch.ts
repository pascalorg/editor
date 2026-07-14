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
// Each affordance tool declares its own props, so the dynamically-resolved
// component is typed with open props (mirrors the core registry's own
// `ComponentType<any>` value type). The loader itself is precisely typed, so
// no `as`-cast is needed to feed it to `lazy`.
type AffordanceToolLoader = () => Promise<{ default: ComponentType<any> }>

const lazyToolCache = new WeakMap<AffordanceToolLoader, ComponentType<any>>()

export function getRegistryAffordanceTool(
  kind: string,
  affordance: string,
): ComponentType<any> | null {
  const def = nodeRegistry.get(kind)
  const loader: AffordanceToolLoader | undefined = def?.affordanceTools?.[affordance]
  if (!loader) return null
  const cached = lazyToolCache.get(loader)
  if (cached) return cached
  const Comp = lazy(loader)
  lazyToolCache.set(loader, Comp)
  return Comp
}

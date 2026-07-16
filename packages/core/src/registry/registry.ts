import type { ZodObject } from 'zod'
import type { AnyNodeDefinition, BakePolicy, NodeRegistry, Plugin } from './types'

const HOST_API_VERSION = 1 as const
const BUILTIN_PLUGIN_ID = 'pascal:core'

const pluginIdsByKind = new Map<string, string>()

// True in dev / test builds, false in production. Tries Vite's
// `import.meta.env.DEV` first (the editor app's bundler) and falls back
// to `process.env.NODE_ENV !== 'production'` for Node test runners.
function isDevMode(): boolean {
  try {
    const meta = import.meta as { env?: { DEV?: boolean } }
    if (typeof meta?.env?.DEV === 'boolean') return meta.env.DEV
  } catch {
    // import.meta unavailable in some CJS contexts — fall through.
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  // No environment signal — be safe and treat as production.
  return false
}

class NodeRegistryImpl implements NodeRegistry {
  private readonly defs = new Map<string, AnyNodeDefinition>()

  has(kind: string): boolean {
    return this.defs.has(kind)
  }

  get(kind: string): AnyNodeDefinition | undefined {
    return this.defs.get(kind)
  }

  entries(): IterableIterator<[string, AnyNodeDefinition]> {
    return this.defs.entries()
  }

  schemas(): ZodObject<any>[] {
    return Array.from(this.defs.values(), (d) => d.schema)
  }

  get size(): number {
    return this.defs.size
  }

  // Internal — exposed via registerNode below.
  _register(def: AnyNodeDefinition): void {
    if (typeof def.kind !== 'string' || def.kind.length === 0) {
      throw new Error('[registry] NodeDefinition.kind must be a non-empty string')
    }
    if (typeof def.schemaVersion !== 'number' || def.schemaVersion < 1) {
      throw new Error(
        `[registry] NodeDefinition.schemaVersion must be a positive integer (kind: "${def.kind}")`,
      )
    }
    // Duplicate-kind handling depends on environment:
    //   - **Production**: throw. The plugin-authoring contract
    //     (`wiki/architecture/plugin-authoring.md`) guarantees that two
    //     plugins shipping `kind: 'couch'` is a startup-time error, not
    //     a silent overwrite — collisions need to be visible.
    //   - **Dev (HMR)**: replace with a warning. Saving `def.ts` would
    //     otherwise either crash on re-execute or skip it entirely,
    //     leaving stale descriptors pinned in memory.
    if (this.defs.has(def.kind)) {
      if (isDevMode()) {
        console.warn(`[registry] re-registering node kind "${def.kind}" (HMR)`)
      } else {
        throw new Error(`[registry] duplicate node kind: "${def.kind}" already registered`)
      }
    }
    this.defs.set(def.kind, def)
  }

  // Test-only — clears the registry. Not exported from the package barrel.
  _reset(): void {
    this.defs.clear()
    pluginIdsByKind.clear()
  }
}

export const nodeRegistry: NodeRegistry & {
  _register: (def: AnyNodeDefinition) => void
  _reset: () => void
} = new NodeRegistryImpl()

export function registerNode(def: AnyNodeDefinition): void {
  nodeRegistry._register(def)
}

/** The plugin that registered a node kind, when it came through {@link loadPlugin}. */
export function getNodePluginId(kind: string): string | undefined {
  return pluginIdsByKind.get(kind)
}

/**
 * Whether a registered kind should participate in a project. Kinds registered
 * directly by the host and the built-in plugin are always enabled. An omitted
 * install list means a legacy scene whose plugin state predates persistence, so
 * loaded plugins remain visible for backward compatibility.
 */
export function isNodeKindEnabled(kind: string, installedPlugins?: readonly string[]): boolean {
  const pluginId = getNodePluginId(kind)
  if (!pluginId || pluginId === BUILTIN_PLUGIN_ID || installedPlugins === undefined) return true
  return installedPlugins.includes(pluginId)
}

/**
 * Returns the set of registered kinds whose definition declares the
 * `selectable` capability. Callers that maintain hardcoded "selectable kinds"
 * lists (SelectionManager, FloatingActionMenu) should concat this with their
 * legacy entries instead of editing the hardcoded list per migration.
 *
 * Phase 6 deletes the hardcoded lists entirely and uses this function as the
 * single source of truth. For now it's additive over the legacy lists so the
 * existing kinds keep working unchanged.
 */
export function getSelectableKinds(): string[] {
  const result: string[] = []
  for (const [kind, def] of nodeRegistry.entries()) {
    if (def.capabilities.selectable !== undefined) {
      result.push(kind)
    }
  }
  return result
}

/**
 * Returns true when the kind is declared selectable in the registry. Use
 * in expression chains like `if (node.type === 'wall' || isRegistrySelectable(node.type))`.
 */
export function isRegistrySelectable(kind: string): boolean {
  return nodeRegistry.get(kind)?.capabilities.selectable !== undefined
}

/**
 * Kinds whose `def.floorplanScope` matches the requested scope. Used by
 * `FloorplanRegistryLayer` to discover building-scoped kinds (e.g.
 * elevator) without hardcoding kind names in the editor layer. `'level'`
 * is the default, so `kindsWithFloorplanScope('level')` includes kinds
 * that didn't set the field at all.
 */
export function kindsWithFloorplanScope(scope: 'level' | 'building'): string[] {
  const result: string[] = []
  for (const [kind, def] of nodeRegistry.entries()) {
    const declared = def.floorplanScope ?? 'level'
    if (declared === scope) result.push(kind)
  }
  return result
}

/**
 * A kind's {@link BakePolicy} from the registry, defaulting to `'static'` for
 * kinds that don't declare one (or aren't registered). The bake and the baked
 * `/viewer` consult this instead of hardcoding kind names — see
 * plans/editor-plugin-trees-example.md → Part D.
 */
export function bakePolicyOf(kind: string): BakePolicy {
  return nodeRegistry.get(kind)?.bake ?? 'static'
}

/** Registered kinds whose {@link BakePolicy} matches `policy`. `'static'` is the
 *  default, so `kindsWithBakePolicy('static')` includes kinds that didn't set it. */
export function kindsWithBakePolicy(policy: BakePolicy): string[] {
  const result: string[] = []
  for (const [kind, def] of nodeRegistry.entries()) {
    if ((def.bake ?? 'static') === policy) result.push(kind)
  }
  return result
}

/**
 * Returns true when the kind is movable from a 2D floor-plan handle —
 * either via `capabilities.movable`, an explicit
 * `def.floorplanMoveTarget`, or an `affordanceTools.move` 3D mover that
 * the floating action menu can engage. Replaces the kind-name ternary
 * chain in `floating-action-menu.tsx`.
 */
export function isRegistryMovable(kind: string): boolean {
  const def = nodeRegistry.get(kind)
  if (!def) return false
  if (def.capabilities.movable !== undefined) return true
  if (def.floorplanMoveTarget !== undefined) return true
  if (def.affordanceTools?.move !== undefined) return true
  return false
}

/**
 * Whether the kind has a move tool that MOUNTS in the 3D viewport — the
 * generic `capabilities.movable` mover or a bespoke `affordanceTools.move`.
 * Narrower than {@link isRegistryMovable}, which also accepts floorplan-only
 * movers (e.g. zone) that have no 3D tool. Gates 3D direct move: Ctrl/Meta-drag
 * and the move-cross grip. Kept beside `isRegistryMovable` so the 2D and 3D
 * movability predicates can't drift apart.
 */
export function hasRegistry3DMoveTool(kind: string): boolean {
  const def = nodeRegistry.get(kind)
  if (!def) return false
  return def.capabilities.movable !== undefined || def.affordanceTools?.move !== undefined
}

/**
 * Whether the kind can be saved as a reusable preset. Default: an
 * explicit `capabilities.presettable` boolean wins; otherwise the kind
 * is presettable iff it declares `def.parametrics`. Read by host apps
 * (community shell) to gate "save as preset" UI on a selection.
 */
export function isPresettable(def: AnyNodeDefinition): boolean {
  if (typeof def.capabilities.presettable === 'boolean') {
    return def.capabilities.presettable
  }
  return def.parametrics !== undefined
}

export function isPresettableKind(kind: string): boolean {
  const def = nodeRegistry.get(kind)
  return def ? isPresettable(def) : false
}

/**
 * Resolve a kind's facing-triangle config, or `null` when it has none.
 * `{ reversed }` says whether the triangle points along the node's local -Z
 * (its front) instead of +Z. One reader (the editor-side `<FacingPoseIndicator>`
 * publishers) so placement and move stay consistent.
 */
export function resolveFacingIndicator(kind: string): { reversed: boolean } | null {
  const facing = nodeRegistry.get(kind)?.facingIndicator
  if (!facing) return null
  return { reversed: facing === true ? false : (facing.reversed ?? false) }
}

/**
 * Names of schema fields on `def` that are host references (`wallId`,
 * `wallT`, etc.). Read by host apps at preset-save time to strip these
 * from the stored payload — see `def.capabilities.hostRefFields` docs.
 * Returns an empty array for kinds that don't declare any.
 */
export function getHostRefFields(def: AnyNodeDefinition): ReadonlyArray<string> {
  return def.capabilities.hostRefFields ?? []
}

/**
 * Whether instances of this kind are created by drawing with a build tool
 * (tool id === node `type`) rather than dropping a finished instance. Read
 * by host apps to route preset placement of such kinds through
 * `setToolDefaults(type, params)` + `setTool(type)` — see
 * `def.capabilities.drawTool` docs.
 */
export function isDrawnViaTool(def: AnyNodeDefinition): boolean {
  return def.capabilities.drawTool === true
}

export function isDrawnViaToolKind(kind: string): boolean {
  const def = nodeRegistry.get(kind)
  return def ? isDrawnViaTool(def) : false
}

export async function loadPlugin(plugin: Plugin): Promise<void> {
  if (plugin.apiVersion !== HOST_API_VERSION) {
    throw new Error(
      `[registry] plugin "${plugin.id}" requires apiVersion ${plugin.apiVersion}; host supports ${HOST_API_VERSION}`,
    )
  }
  for (const def of plugin.nodes ?? []) {
    registerNode(def)
    pluginIdsByKind.set(def.kind, plugin.id)
  }
}

/**
 * App-level plugin discovery hook. The bootstrap loads `builtinPlugin`
 * unconditionally and then awaits this to pick up any extra plugins
 * (third-party node packs, AI-authored bundles, user-installed kinds).
 * Defaults to returning `[]` — apps that want external plugins call
 * {@link setPluginDiscovery} before the bootstrap module runs.
 *
 * Kept async so a future loader can fetch over the network without
 * changing the contract. See `wiki/architecture/plugin-authoring.md` for
 * the plugin author surface this enables.
 */
export type PluginDiscovery = () => Promise<Plugin[]>

const defaultPluginDiscovery: PluginDiscovery = async () => []

let pluginDiscovery: PluginDiscovery = defaultPluginDiscovery

/**
 * Replace the plugin discovery implementation. Call once at app startup
 * before {@link discoverPlugins} is invoked (bootstrap order matters).
 *
 * The contract is intentionally minimal — just "return a list of
 * plugins to load." The loader can be a static `import.meta.glob`, a
 * `fetch` against a registry endpoint, a worker IPC, etc. Each returned
 * plugin still goes through {@link loadPlugin} so the same API-version
 * gate + duplicate-kind protection applies.
 */
export function setPluginDiscovery(fn: PluginDiscovery): void {
  if (isDevMode() && pluginDiscovery !== defaultPluginDiscovery) {
    console.warn(
      '[registry] setPluginDiscovery replaced an existing discovery chain — plugins registered earlier (e.g. via extendPluginDiscovery) are dropped. Use extendPluginDiscovery to compose instead.',
    )
  }
  pluginDiscovery = fn
}

/**
 * Extend the current plugin discovery instead of replacing it. Useful for app-
 * bundled example or first-party plugins that should load alongside any host-
 * provided discovery source, not clobber it.
 */
export function extendPluginDiscovery(fn: PluginDiscovery): void {
  const previous = pluginDiscovery
  pluginDiscovery = async () => {
    const [base, extra] = await Promise.all([previous(), fn()])
    return [...base, ...extra]
  }
}

/**
 * Run the active plugin discovery and return the discovered plugins.
 * Bootstrap code is expected to call this after `loadPlugin(builtinPlugin)`
 * and then `await loadPlugin(...)` each result in order.
 */
export function discoverPlugins(): Promise<Plugin[]> {
  return pluginDiscovery()
}

import type { ZodObject } from 'zod'
import type { AnyNodeDefinition, BakePolicy, NodeRegistry, Plugin, PluginPanel } from './types'

const HOST_API_VERSION = 1 as const

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
  }
}

export const nodeRegistry: NodeRegistry & {
  _register: (def: AnyNodeDefinition) => void
  _reset: () => void
} = new NodeRegistryImpl()

export function registerNode(def: AnyNodeDefinition): void {
  nodeRegistry._register(def)
}

/**
 * Registry of left-rail panels contributed by plugins. Same add-only,
 * duplicate-id-throws semantics as the node registry, with one difference: it
 * is *observable*. Plugin discovery runs asynchronously after the first React
 * render (see `loadExternalPlugins`), so the sidebar subscribes via
 * {@link PanelRegistryImpl.subscribe} / {@link PanelRegistryImpl.getSnapshot}
 * (the `useSyncExternalStore` contract) and re-renders when a panel lands.
 * `getSnapshot` returns a stable array reference between registrations so the
 * subscribing component doesn't re-render in a loop.
 */
class PanelRegistryImpl {
  private readonly panels = new Map<string, PluginPanel>()
  private readonly listeners = new Set<() => void>()
  private cached: PluginPanel[] = []
  // node kind → the (namespaced) panel id of the plugin that shipped it.
  // Populated by `loadPlugin`; lets a host's "find in catalog" open the
  // panel that places a kind without hardcoding per-plugin knowledge.
  private readonly kindPanels = new Map<string, string>()

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): PluginPanel[] => this.cached

  _register(panel: PluginPanel): void {
    if (typeof panel.id !== 'string' || panel.id.length === 0) {
      throw new Error('[registry] PluginPanel.id must be a non-empty string')
    }
    if (this.panels.has(panel.id)) {
      if (isDevMode()) {
        console.warn(`[registry] re-registering plugin panel "${panel.id}" (HMR)`)
      } else {
        throw new Error(`[registry] duplicate plugin panel id: "${panel.id}" already registered`)
      }
    }
    this.panels.set(panel.id, panel)
    this.emit()
  }

  _associateKind(kind: string, panelId: string): void {
    this.kindPanels.set(kind, panelId)
  }

  /** The (namespaced) panel id of the plugin that registered `kind`, if any. */
  panelForKind = (kind: string): string | undefined => this.kindPanels.get(kind)

  // Test-only — clears the registry. Not exported from the package barrel.
  _reset(): void {
    this.panels.clear()
    this.kindPanels.clear()
    this.emit()
  }

  private emit(): void {
    this.cached = Array.from(this.panels.values())
    for (const fn of this.listeners) fn()
  }
}

export const panelRegistry: {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => PluginPanel[]
  panelForKind: (kind: string) => string | undefined
  _register: (panel: PluginPanel) => void
  _associateKind: (kind: string, panelId: string) => void
  _reset: () => void
} = new PanelRegistryImpl()

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
  }
  for (const panel of plugin.panels ?? []) {
    // Namespace the panel id by its owning plugin so two plugins can each
    // ship a panel id of `'main'`. The namespaced id is what the sidebar
    // uses as `activeSidebarPanel`.
    panelRegistry._register({ ...panel, id: `${plugin.id}:${panel.id}` })
  }
  // Associate every node kind with the plugin's first panel — the panel a
  // host's "find in catalog" should open to place more of that kind.
  const firstPanel = plugin.panels?.[0]
  if (firstPanel) {
    for (const def of plugin.nodes ?? []) {
      panelRegistry._associateKind(def.kind, `${plugin.id}:${firstPanel.id}`)
    }
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

let pluginDiscovery: PluginDiscovery = async () => []

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
  pluginDiscovery = fn
}

/**
 * Run the active plugin discovery and return the discovered plugins.
 * Bootstrap code is expected to call this after `loadPlugin(builtinPlugin)`
 * and then `await loadPlugin(...)` each result in order.
 */
export function discoverPlugins(): Promise<Plugin[]> {
  return pluginDiscovery()
}

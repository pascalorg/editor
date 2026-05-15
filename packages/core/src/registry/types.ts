import type { ComponentType } from 'react'
import type { Object3D } from 'three'
import type { ZodObject, z } from 'zod'
import type { AnyNode, AnyNodeId } from '../schema/types'

// ─── GeometryContext ─────────────────────────────────────────────────
//
// Read-only scene access passed to `def.geometry(node, ctx)`. Most kinds'
// builders ignore `ctx` and read only `node` (shelf, item, spawn). Kinds
// whose meshes reference other nodes by ID — wall miters with siblings,
// door cutouts read parent wall — use `ctx` to resolve those references
// without importing `useScene`. Builders stay pure and unit-testable.
//
// Future extension: `levelData?: { miters?: ... }` for level-scoped batch
// data (wall mitering across an entire level). Decided alongside the wall
// migration off its dedicated system (Phase 3+).

export type GeometryContext = {
  /** Look up any node by ID. Returns undefined if the node doesn't exist. */
  resolve: <N = AnyNode>(id: AnyNodeId) => N | undefined
  /** Resolved children of this node (filters out unresolvable IDs). */
  children: AnyNode[]
  /** Same kind, same parent — drives wall mitering / endpoint-match. */
  siblings: AnyNode[]
  /** Resolved parent (null for root-level nodes). */
  parent: AnyNode | null
}

// ─── FloorplanGeometry ───────────────────────────────────────────────
//
// Output shape for `def.floorplan(node, ctx)`. The floor-plan panel
// converts these primitives to React-SVG elements via a generic renderer
// — kinds never touch SVG nodes directly. Coordinates are level-local
// meters; the panel handles world→SVG transform via its viewBox.
//
// Visual styling lives in the geometry so an AI-authored kind can pick
// its own colors without needing to know about CSS / theme tokens. The
// renderer maps these directly to SVG attributes.

export type FloorplanPoint = readonly [x: number, y: number]

export type FloorplanStyle = {
  stroke?: string
  fill?: string
  strokeWidth?: number
  strokeDasharray?: string
  opacity?: number
}

// ─── ToolHint ────────────────────────────────────────────────────────
//
// A single key + label entry in the contextual shortcut hint panel.
// `HelperManager` consults `def.toolHints` when the active tool matches
// a registered kind; matches the existing per-tool helper components
// today (e.g. WallHelper renders three of these entries).

export type ToolHint = {
  /** Key combo or input label, e.g. 'Left click', 'Shift', 'Esc'. */
  key: string
  /** Description of what the input does. Sentence case. */
  label: string
}

export type FloorplanGeometry =
  | ({ kind: 'path'; d: string } & FloorplanStyle)
  | ({ kind: 'polygon'; points: readonly FloorplanPoint[] } & FloorplanStyle)
  | ({
      kind: 'polyline'
      points: readonly FloorplanPoint[]
    } & FloorplanStyle)
  | ({
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      rx?: number
      ry?: number
    } & FloorplanStyle)
  | ({ kind: 'circle'; cx: number; cy: number; r: number } & FloorplanStyle)
  | ({
      kind: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
    } & FloorplanStyle)
  | {
      kind: 'group'
      children: FloorplanGeometry[]
      /** Optional transform applied to all children. Rotation in radians. */
      transform?: { translate?: FloorplanPoint; rotate?: number }
    }

// ─── Plugin manifest ─────────────────────────────────────────────────

export type Plugin = {
  id: string
  apiVersion: 1
  nodes?: AnyNodeDefinition[]
}

// ─── NodeDefinition ──────────────────────────────────────────────────

export type AnyNodeDefinition = NodeDefinition<ZodObject<any>>

export type NodeDefinition<S extends ZodObject<any>> = {
  kind: string
  schemaVersion: number
  schema: S
  category: NodeCategory

  defaults: () => Omit<z.infer<S>, 'id' | 'type'>
  migrate?: Record<number, (old: unknown) => unknown>

  capabilities: Capabilities
  relations?: Relations
  parametrics?: ParametricDescriptor<z.infer<S>>

  /**
   * Renderer for this kind. Optional under the three-checkbox composition
   * model (see `wiki/architecture/node-definitions.md`): when omitted, the
   * framework mounts a generic empty-group renderer that the per-kind
   * geometry/system fills. Required today only because the generic
   * renderer is not yet implemented — Phase 4 lands it, then this field
   * becomes truly optional at runtime too. Making the type optional now so
   * milestone-A skeletons (like wall) can compile before their runtime
   * port; downstream consumers (`<NodeRenderer>`, `RegisteredSystems`)
   * already null-guard on `def.renderer` so omitting it is safe.
   */
  renderer?: RendererSource<z.infer<S>>
  /**
   * Pure geometry builder. When set, the framework's generic
   * `<GeometrySystem>` calls this on every dirty mark — `nodes` keyed by
   * `def.geometry`'s presence are picked up; the returned `Object3D`'s
   * children replace the registered group's children. Together with
   * `<ParametricNodeRenderer>` this lets a kind ship without per-kind
   * `renderer.tsx` or `system.tsx` files (see
   * `wiki/architecture/node-definitions.md`). Combine with `renderer` if
   * you want JSX-side composition (drei, `<Html>`, GLB) AND parametric
   * rebuilds; combine with `system` if you also need per-frame imperative
   * work (animations, named-mesh material poking).
   */
  geometry?: (node: z.infer<S>, ctx: GeometryContext) => Object3D
  /**
   * Pure 2D builder for floor-plan rendering. Mirrors `geometry` but emits
   * plain `FloorplanGeometry` data (SVG-renderable) rather than three.js
   * Object3D. Coordinates are level-local meters — the floor-plan panel
   * applies the world→SVG transform.
   *
   * Returns `null` when the kind shouldn't appear in floor plan (e.g. an
   * invisible utility node, or a kind that's 3D-only). Kinds that need
   * floor-plan rendering but no 3D mesh set `floorplan` without `geometry`.
   *
   * See `wiki/architecture/node-definitions.md` ("floor-plan rendering"
   * section) and Phase 5 of the registry plan for the migration plan off
   * the legacy `floorplan-panel.tsx` monolith.
   */
  floorplan?: (node: z.infer<S>, ctx: GeometryContext) => FloorplanGeometry | null
  system?: SystemContribution
  tool?: LazyComponent
  /**
   * Stage-D drag-affordance components — one per kind-owned editor mode
   * triggered by `useEditor` state. Component receives `{ node }` as its
   * sole prop. Lazy-loaded by ToolManager when the corresponding editor
   * state activates (e.g. `curvingFence` → `affordanceTools.curve`).
   *
   * Each component is the thin React wrapper around a pure DragAction
   * primitive that lives in the kind's `actions/` folder. The split keeps
   * the action data unit-testable while letting the wrapper consume
   * `useDragAction` + cursor visuals.
   *
   * Generic record so per-kind state names don't need to land in the
   * core type system. ToolManager looks up by string key.
   */
  affordanceTools?: Record<string, () => Promise<{ default: ComponentType<any> }>>
  affordances?: Affordance<z.infer<S>>[]
  /**
   * Contextual shortcut hints shown by `HelperManager` when this kind's
   * tool is active. Pure data — `HelperManager` renders these via a
   * generic <RegisteredToolHelper>. Drops the need for a hand-written
   * `<XxxHelper>` component per kind.
   *
   * Static array for now (covers ~all current uses). If a kind needs
   * state-dependent hints (e.g. different keys during a drag), it keeps
   * its bespoke helper component instead.
   */
  toolHints?: ToolHint[]

  /**
   * Optional translucent preview of the node — used by the move tool to
   * show where the node will land, and by the placement tool's cursor.
   * Receives the partially-resolved node (or a default-shaped stub during
   * placement before any commit has happened). Phase 4 may merge this with
   * the renderer behind an `opacity` prop.
   */
  preview?: () => Promise<{ default: ComponentType<{ node: z.infer<S> }> }>

  presentation?: Presentation
  mcp?: McpOverrides
}

export type NodeCategory = 'site' | 'structure' | 'furnish' | 'analysis' | 'utility'

// ─── Presentation (tool palette + UI surface) ────────────────────────

/**
 * UI metadata for surfacing a node kind in the tool palette and elsewhere.
 * Phase 4 ships the consumer (auto-derived palette buttons); definitions can
 * declare this from Phase 2 onward so the spike's `column` and `shelf` show up
 * correctly the moment the palette consumes the registry.
 */
export type Presentation = {
  /** Sentence-case label shown in palette buttons, breadcrumbs, etc. */
  label: string
  /** Optional longer tooltip / help text. */
  description?: string
  /** Icon for palette buttons and tree views. */
  icon: IconRef
  /** Tool palette section. Defaults to `category` when omitted. */
  paletteSection?: 'site' | 'structure' | 'furnish'
  /** Sort key within a palette section; lower numbers come first. */
  paletteOrder?: number
  /** Set true for kinds that exist but should NOT appear in the palette
   * (containers like `site`/`building`/`level`, internal nodes). */
  hidden?: boolean
}

export type IconRef =
  /** Iconify identifier, e.g. `lucide:square`. Matches the @iconify-react
   * setup the editor app already uses for tool icons. */
  | { kind: 'iconify'; name: string }
  /** Inline SVG path data. Use for asset packs or plugins that want a custom
   * mark without contributing a React component. */
  | { kind: 'svg'; viewBox: string; path: string }
  /** Custom React component, lazy-loaded. Use sparingly — adds a Suspense
   * boundary per icon. */
  | { kind: 'component'; module: () => Promise<{ default: ComponentType }> }

export type LazyComponent = () => Promise<{ default: ComponentType }>

export type RendererSource<N> =
  | {
      kind: 'parametric'
      module: () => Promise<{ default: ComponentType<{ node: N }> }>
    }
  | { kind: 'glb'; getAsset: (n: N) => AssetRef }
  | { kind: 'instanced-glb'; getAsset: (n: N) => AssetRef }

export type AssetRef = {
  id: string
  src: string
}

export type SystemContribution = {
  module: () => Promise<{ default: ComponentType }>
  priority?: number
}

export type McpOverrides = {
  description?: string
  semantic?: boolean
}

// ─── Capabilities ────────────────────────────────────────────────────

export type Capabilities = {
  movable?: MovableConfig
  rotatable?: RotatableConfig
  scalable?: ScalableConfig
  hostable?: HostableConfig
  cuttable?: CuttableConfig
  snappable?: SnappableConfig
  surfaces?: SurfacesConfig
  duplicable?: boolean
  deletable?: boolean
  groupable?: boolean
  selectable?: SelectableConfig
  interactive?: boolean
}

export type CapabilityCtx = { node: AnyNode }

export type MovableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  gridSnap?: boolean
  override?: (ctx: CapabilityCtx) => MovableConfig | null
}

export type RotatableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  snapAngles?: readonly number[]
  override?: (ctx: CapabilityCtx) => RotatableConfig | null
}

export type ScalableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  min?: number
  max?: number
  override?: (ctx: CapabilityCtx) => ScalableConfig | null
}

export type HostableConfig = {
  parents: readonly string[]
  align?: 'top' | 'bottom' | 'center' | 'face'
  fromAsset?: 'attachTo'
  modes?: Record<string, Partial<HostableConfig>>
  override?: (ctx: CapabilityCtx) => HostableConfig | null
}

export type CuttableConfig = {
  hostKinds: readonly string[]
  override?: (ctx: CapabilityCtx) => CuttableConfig | null
}

export type SnappableConfig = {
  points?: readonly SnapPointKind[]
  override?: (ctx: CapabilityCtx) => SnappableConfig | null
}

export type SnapPointKind = 'start' | 'end' | 'midpoint' | 'center' | 'corners'

export type SurfacesConfig = {
  top?: { height: number | ((n: AnyNode) => number) }
  sides?: { faces: 'all' | ReadonlyArray<readonly [number, number, number]> }
  custom?: SurfaceQuery
}

export type SurfaceQuery = (n: AnyNode) => SurfacePoint[]
export type SurfacePoint = {
  position: readonly [number, number, number]
  normal: readonly [number, number, number]
}

export type SelectableConfig = {
  hitVolume?: 'bbox' | 'mesh' | 'none'
  override?: (ctx: CapabilityCtx) => SelectableConfig | null
}

// ─── Relations ───────────────────────────────────────────────────────

export type Relations = {
  linkedBy?: 'endpoint-match' | 'polygon-share' | { custom: (n: AnyNode) => AnyNodeId[] }
  hosts?: readonly string[]
  affectsSpatial?: readonly string[]
  cascadeDelete?: 'descendants' | 'children' | 'none'
}

// ─── ParametricDescriptor ────────────────────────────────────────────

export type ParametricDescriptor<N> = {
  groups: ParamGroup<N>[]
  invariants?: ReadonlyArray<(n: N) => Issue[]>
  derive?: (n: N) => Partial<N>
  customPanel?: () => Promise<{ default: ComponentType<{ node: N }> }>
}

export type ParamGroup<N> = {
  label: string
  fields: ParamField<N>[]
}

export type ParamField<N> =
  | {
      key: keyof N
      kind: 'number'
      unit?: string
      min?: number
      max?: number
      step?: number
      visibleIf?: (n: N) => boolean
      customEditor?: ComponentType
    }
  | { key: keyof N; kind: 'enum'; options: readonly string[]; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'vec3'; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'color'; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'material'; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'ref'; refKind: string; visibleIf?: (n: N) => boolean }

export type Issue = { field?: string; msg: string; severity?: 'error' | 'warning' }

// ─── Affordance ──────────────────────────────────────────────────────

export type Affordance<N> = {
  id: string
  mount: 'on-selection' | 'on-hover' | 'always'
  enabled?: (n: N, ctx: EditorCtx) => boolean
  component: () => Promise<{ default: ComponentType<{ node: N }> }>
}

export type EditorCtx = {
  modifiers: Modifiers
}

// ─── DragAction primitive ────────────────────────────────────────────

export type Vec2 = readonly [number, number]
export type Modifiers = { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }

export type DragAction<Ctx, Draft> = {
  begin: (input: { node?: AnyNode; point: Vec2; handleId?: string; modifiers?: Modifiers }) => Ctx
  preview: (ctx: Ctx, point: Vec2, modifiers: Modifiers) => Draft
  snap?: (draft: Draft, ctx: Ctx, services: SnapServicesLike) => Draft
  apply: (draft: Draft, ctx: Ctx, scene: SceneApi) => Iterable<AnyNodeId>
  commit?: (draft: Draft, ctx: Ctx, scene: SceneApi) => boolean
  cancel: (ctx: Ctx, scene: SceneApi) => void
}

// Phase 1 fleshes out SnapServices; PR 0.1 only needs the placeholder type.
export type SnapServicesLike = unknown

// ─── SceneApi ────────────────────────────────────────────────────────

export type SceneApi = {
  get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => N | undefined
  update: (id: AnyNodeId, patch: Partial<AnyNode>) => void
  upsert: (node: AnyNode, parentId?: AnyNodeId) => AnyNodeId
  delete: (id: AnyNodeId) => void
  restore: (id: AnyNodeId) => void
  restoreAll: () => void
  markDirty: (id: AnyNodeId) => void
  pauseHistory: () => void
  resumeHistory: () => void
}

// ─── Registry surface ────────────────────────────────────────────────

export interface NodeRegistry {
  has: (kind: string) => boolean
  get: (kind: string) => AnyNodeDefinition | undefined
  entries: () => IterableIterator<[string, AnyNodeDefinition]>
  schemas: () => ZodObject<any>[]
  readonly size: number
}

import type { ComponentType } from 'react'
import type { ZodObject, z } from 'zod'
import type { AnyNode, AnyNodeId } from '../schema/types'

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

  renderer: RendererSource<z.infer<S>>
  system?: SystemContribution
  tool?: LazyComponent
  affordances?: Affordance<z.infer<S>>[]

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

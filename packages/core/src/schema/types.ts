import z from 'zod'
import { ProceduralItemNode } from '../procedural-items/node'
import { BlockNode } from './nodes/block'
import { BoxVentNode } from './nodes/box-vent'
import { BuildingNode } from './nodes/building'
import { CabinetModuleNode, CabinetNode } from './nodes/cabinet'
import { CeilingNode } from './nodes/ceiling'
import { ChimneyNode } from './nodes/chimney'
import { ColumnNode } from './nodes/column'
import { ConstructionDimensionNode } from './nodes/construction-dimension'
import { CupolaNode } from './nodes/cupola'
import { DoorNode } from './nodes/door'
import { DormerNode } from './nodes/dormer'
import { DownspoutNode } from './nodes/downspout'
import { DuctFittingNode } from './nodes/duct-fitting'
import { DuctSegmentNode } from './nodes/duct-segment'
import { DuctTerminalNode } from './nodes/duct-terminal'
import { ElevatorNode } from './nodes/elevator'
import { EyebrowVentNode } from './nodes/eyebrow-vent'
import { FenceNode } from './nodes/fence'
import { FenceGateNode, FenceOpeningNode } from './nodes/fence-feature'
import { GuideNode } from './nodes/guide'
import { GutterNode } from './nodes/gutter'
import { HvacEquipmentNode } from './nodes/hvac-equipment'
import { ImportedMeshNode } from './nodes/imported-mesh'
import { ItemNode } from './nodes/item'
import { LeanToExtensionNode } from './nodes/lean-to-extension'
import { LevelNode } from './nodes/level'
import { LinesetNode } from './nodes/lineset'
import { LiquidLineNode } from './nodes/liquid-line'
import { MeasurementNode } from './nodes/measurement'
import { PipeFittingNode } from './nodes/pipe-fitting'
import { PipeSegmentNode } from './nodes/pipe-segment'
import { PipeTrapNode } from './nodes/pipe-trap'
import { RidgeVentNode } from './nodes/ridge-vent'
import { RoofNode } from './nodes/roof'
import { RoofSegmentNode } from './nodes/roof-segment'
import { ScanNode } from './nodes/scan'
import { ShelfNode } from './nodes/shelf'
import { SiteNode } from './nodes/site'
import { SkylightNode } from './nodes/skylight'
import { SlabNode } from './nodes/slab'
import { SolarPanelNode } from './nodes/solar-panel'
import { SpawnNode } from './nodes/spawn'
import { StairNode } from './nodes/stair'
import { StairSegmentNode } from './nodes/stair-segment'
import { StructuralGridNode } from './nodes/structural-grid'
import { TurbineVentNode } from './nodes/turbine-vent'
import { UnitNode } from './nodes/unit'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

/** A node schema as authored: `type` is a literal wrapped by `nodeType()`'s `.default()`. */
type NodeMember = z.ZodObject<{ type: z.ZodDefault<z.ZodLiteral<string>> } & z.core.$ZodLooseShape>

/** The same schema with the discriminator narrowed back to its bare literal. */
type BareDiscriminator<T extends NodeMember> = z.ZodObject<
  Omit<T['shape'], 'type'> & { type: ReturnType<T['shape']['type']['unwrap']> }
>

/**
 * Assembles the node union on discriminators that claim exactly one value.
 *
 * `nodeType()` defaults the literal so a per-kind schema can fill `type` in
 * (`WallNode.parse({ start, end })`), but a `.default()`-wrapped discriminator
 * also claims `undefined` from zod 4.5 on (upstream #6432). With 48 members
 * doing it, the union's lazily-built discriminator map collides on
 * `undefined` and throws `Duplicate discriminator value` — as a plain Error,
 * so it escapes `safeParse` and surfaces as a crash at the first parse.
 *
 * Each member is therefore projected to a clone whose `type` is the bare
 * literal. Per-kind schemas keep their default; only the union's view of the
 * discriminator narrows. `safeExtend` retains member refinements, including
 * procedural recipe/parameter validation. Metadata lives in zod's global registry keyed by
 * instance, so `.describe()` text has to be carried over to the clone by hand.
 */
export const nodeUnion = <const T extends readonly [NodeMember, ...NodeMember[]]>(members: T) =>
  z.discriminatedUnion(
    'type',
    members.map((member) => {
      const projected = member.safeExtend({ type: member.shape.type.unwrap() })
      const meta = z.globalRegistry.get(member)
      return meta ? projected.meta(meta) : projected
    }) as { [K in keyof T]: BareDiscriminator<T[K]> },
  )

export const AnyNode = nodeUnion([
  SiteNode,
  BuildingNode,
  ElevatorNode,
  UnitNode,
  LevelNode,
  LeanToExtensionNode,
  ColumnNode,
  ConstructionDimensionNode,
  BlockNode,
  StructuralGridNode,
  WallNode,
  FenceNode,
  FenceGateNode,
  FenceOpeningNode,
  CabinetNode,
  CabinetModuleNode,
  ItemNode,
  ProceduralItemNode,
  ImportedMeshNode,
  ZoneNode,
  SlabNode,
  CeilingNode,
  RoofNode,
  RoofSegmentNode,
  ShelfNode,
  StairNode,
  StairSegmentNode,
  ScanNode,
  GuideNode,
  MeasurementNode,
  SpawnNode,
  WindowNode,
  DoorNode,
  BoxVentNode,
  RidgeVentNode,
  TurbineVentNode,
  CupolaNode,
  EyebrowVentNode,
  GutterNode,
  ChimneyNode,
  SolarPanelNode,
  SkylightNode,
  DormerNode,
  DownspoutNode,
  DuctSegmentNode,
  DuctFittingNode,
  DuctTerminalNode,
  HvacEquipmentNode,
  LinesetNode,
  LiquidLineNode,
  PipeSegmentNode,
  PipeFittingNode,
  PipeTrapNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']

/** One member schema of `AnyNode`, discriminator already projected to a bare literal. */
export type AnyNodeOption = (typeof AnyNode)['options'][number]

/** The node kind a union member accepts, read off its bare-literal discriminator. */
export const nodeKindOf = (option: AnyNodeOption): AnyNodeType => option.shape.type.value

// ─── Fidelity F0 contract names (frozen, type-only) ─────────────────────
//
// Frozen by plan item A-02 (`editor-fidelity-foundations.md` F0). Nothing in
// the runtime reads these yet: each later slice (F1 sections, F5a anchors,
// F6 mounts, SI-R2 patterns) implements its name as a zod schema whose
// inferred type must stay assignable both ways to the one frozen here, and
// the executable examples in `contracts/fidelity.test.ts` pin the numbers.
// Absent fields keep today's meaning: none of these adds a default.

/** A plan-or-surface 2-vector in metres. */
export type FidelityV2 = readonly [number, number]
/** A 3-vector in metres, in the frame the owning field names. */
export type FidelityV3 = readonly [number, number, number]

/**
 * Identity of a generated part within its owner (F3):
 * `${generatorId}/${role}/${station}[/${sub}]`. A spacing station is its
 * integer lattice index `s<k>`, k = round((at − origin) / spacing), so a key
 * survives reload, split and extension. The owner node is implicit.
 */
export type PartKey = `${string}/${string}/${string}`

/**
 * One finite surface patch of a host (F5a). Never names a family of faces.
 * `riser:<zoneId>/<boundaryKey>[/<k>]` replaces the retired `riser:<zoneId>`.
 * Wider recipe surface ids stay plain `SurfaceId` strings.
 */
export type SurfacePatchId =
  | 'front'
  | 'back'
  | 'top'
  | 'underside'
  | 'bearing'
  | `cladding:${string}`
  | `riser:${string}/${string}`
  | `facet:${string}:covering`
  | `facet:${string}:underside`
  | `edge:${string}`
  | `face:${string}`

/** What an anchor does when its patch or part splits, merges or vanishes. Absent = follow. */
export type AnchorPolicy = 'follow' | 'freeze'

/**
 * A point on one host patch (F5a): `Mount.surface` when `host` is `surface`.
 *
 * Chart (frozen): `point = [u, v, offset]` in metres. u is the patch frame's
 * local +X, offset runs along its outward normal (local +Y, the
 * `SurfaceFrame.normal`), and v = normal × u, so (u, v, normal) is
 * right-handed. In frame-local coordinates that is (x = u, y = offset,
 * z = −v); a `SurfaceRegion` point [x, z] is [u, −v]. On a wall's front patch
 * u runs along the wall and v up the face.
 */
export type SurfaceAnchor = {
  nodeId: string
  partKey?: PartKey
  surfaceId: string
  point: FidelityV3
  /** Part anchors: the part's station when written; > 1 mm drift = unresolved. */
  at?: number
  policy?: AnchorPolicy
}

/**
 * The contact enum (F6), stored as the node's own `anchor` field (items,
 * devices), never inside `Mount`: which envelope height sits on the mount
 * point. No default: a node without `anchor` keeps its legacy pose meaning.
 */
export type Anchor = 'bottom' | 'center' | 'top'

export type WallMountDatum = 'floor' | 'wall-base' | 'wall-top' | 'ceiling'

/** Orientation only. A normal never elects a height. */
export type MountAlign = 'normal' | 'plumb'

/**
 * The placement intent (F6); the stored pose is only a fallback.
 *
 * Frames (frozen):
 * - Horizontal hosts (`ceiling`, `floor`): `x`, `z` are level-local plan
 *   metres from the level origin, +Y up. The height is the evaluated host
 *   surface at (x, z); the envelope's footprint centre sits on (x, z).
 * - Vertical hosts (`wall`, and `surface` on a vertical patch): the node's
 *   local +Z is the finished face's outward normal and its local z = 0 plane
 *   (the envelope's back) lies on the finished face: the body face at
 *   ±thickness/2 where bare, a cladding's outer face where clad. `along` is
 *   measured on the face, `height` above `datum` (default `floor`: the
 *   finished floor on that side).
 * - The node's `anchor` names the envelope height (local +Y) that sits on
 *   the mount point. `align` orients the node; it never changes the elected
 *   height.
 */
export type Mount =
  | {
      host: 'wall'
      wallId: string
      side: 'front' | 'back'
      along: number
      from?: 'start' | 'end' | 'opening'
      ref?: string
      height: number
      datum?: WallMountDatum
    }
  | {
      host: 'ceiling'
      ceilingId: string
      x: number
      z: number
      align?: MountAlign
    }
  | { host: 'floor'; x: number; z: number; supportSlabId?: string }
  | { host: 'surface'; surface: SurfaceAnchor }
  | { host: 'free' }

export type MountHost = Mount['host']

/** A fit target for walls and service spaces (F5a); generalises `roofFit`. */
export type FitTarget = {
  source: 'roof' | 'ceiling' | 'slab'
  ids?: string[]
  datum?: 'underside' | 'top'
  offset?: number
}

/**
 * A pinned definition (F1, F6 §Definitions are pinned). A saved scene names the
 * exact version or content hash it used, or carries the resolved payload
 * itself, so it resolves offline and a library correction never moves saved
 * geometry. Never a mutable global id or an account lookup. Exactly one arm:
 * a pin is a version or a hash, never both.
 *
 * `hash` is `sha256:` + lowercase hex SHA-256 of the UTF-8 bytes of the
 * resolved definition serialized with RFC 8785 JSON Canonicalization (JCS):
 * object keys sorted by UTF-16 code units, no whitespace, ECMAScript number
 * and string serialization. Key order in the source never changes the hash.
 */
export type DefinitionPin =
  | { id: string; v: number; hash?: never }
  | { hash: `sha256:${string}`; id?: never; v?: never }

export type SectionFamily = 'I' | 'C' | 'L' | 'T' | 'Z' | 'rect-tube'

/** One section (F1). Metres; section x = across, y = up. */
export type SectionProfile =
  | { kind: 'rectangle'; width: number; depth: number; corner?: number }
  | { kind: 'round'; radius: number; wall?: number }
  | { kind: 'oval'; width: number; depth: number }
  | {
      kind: 'section'
      family: SectionFamily
      width: number
      depth: number
      web: number
      flange: number
    }
  | { kind: 'polygon'; outer: FidelityV2[]; holes?: FidelityV2[][] }
  | { kind: 'ref'; id: string; v: number; scale?: FidelityV2 }

/** A section with its geometry inline: what a `ref` resolves to. */
export type ResolvedSectionProfile = Exclude<SectionProfile, { kind: 'ref' }>

/**
 * Section library (owner decision O4, frozen): a small immutable, versioned
 * core baseline (`source: 'core'`: rectangles, rounds, nominal lumber mapped
 * to actual sizes, standard steel shapes) plus portable presets
 * (`source: 'preset'`: casings, mouldings, fascia and gutter sections,
 * handrails, regional catalogues) that a scene pins by `{ id, v }` or content
 * hash and can carry with the project. An entry never changes once published.
 */
export type SectionLibraryEntry = {
  id: string
  v: number
  source: 'core' | 'preset'
  profile: ResolvedSectionProfile
  /** The section point that rides the path, in section metres. */
  ride: FidelityV2
}

/**
 * A member end cut (R §D2) as the sweep builder consumes it (F1). The cut
 * plane has `normal` (the path's frame; normalised before use) and crosses
 * the path `offset` metres beyond its end along the end tangent (negative
 * trims). The builder moves the swept end vertex by `offset` and passes
 * `normal` as `SweepEndSpec.cut.normal`; the persisted path never moves.
 * |n̂ · t| < 0.1 is a validation finding.
 */
export type EndCut = { normal: FidelityV3; offset: number }

/** A sweep end (F1): a planar cut through the end vertex and an optional cap. */
export type SweepEndSpec = { cut?: { normal: FidelityV3 }; cap?: boolean }

export type MaterialPatternType =
  | 'running-bond'
  | 'stack'
  | 'herringbone'
  | 'french'
  | 'plank'
  | 'lap'
  | 'seam'
  | 'grid'
  | 'mesh'

/**
 * One portable pattern parameter set (SI-R2, versioned). Lengths are metres in
 * UV space, where 1 UV unit = 1 m. `grid` (openings of `unit` between bars
 * `joint` wide) and `mesh` (wire of diameter `wire` at pitch `unit`) also
 * emit an alpha mask whose open fraction equals the geometric one; masks are
 * alpha-tested at 0.5, never blended, and reach the GLB as a texture. The other
 * types are opaque and emit no mask.
 */
export type MaterialPattern = {
  v: 1
  type: MaterialPatternType
  unit: FidelityV2
  joint: number
  jointColor?: string
  bevel?: number
  variation?: number
  seed?: number
  wire?: number
}

export type DisplayMode = 'finished' | 'construction' | 'systems'

/** What a physical part is, for display and export (F4). A missing tag reads as `finish`. */
export type DisplayFamily =
  | 'finish'
  | 'exposed-structure'
  | 'framing'
  | 'masonry'
  | 'sheathing'
  | 'insulation'
  | 'membrane'
  | 'fill'
  | 'foundation'
  | 'service-space'
  | 'device'
  | 'run'
  | 'inspection'

export type Discipline = 'mechanical' | 'plumbing' | 'electrical' | 'low-voltage' | 'fire'

/**
 * The project's saved look on the `site` node (owner decision O3, frozen), never
 * a scene-root key. `display` is the saved default for the personal display
 * state; SI-R5 adds `theme`, `sun`, `exposure`, `edges` and `shading` beside
 * it. Precedence: explicit local viewer toggles > `site.presentation` >
 * theme defaults. The canonical bake ignores it.
 */
export type SitePresentation = {
  display?: {
    mode?: DisplayMode
    families?: Partial<Record<DisplayFamily, boolean>>
    disciplines?: Partial<Record<Discipline, boolean>>
    xray?: boolean
    colorBy?: 'material' | 'service'
  }
}

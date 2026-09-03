/**
 * Wall assemblies — real layered stacks with true thicknesses, plus the
 * offset-miter geometry that lets the layer boundaries be drawn on the 2D plan
 * with clean corners.
 *
 * ## Where the numbers come from
 *
 * Every thickness below is copied from the assembly data that
 * `@pascal-app/plugin-bones` already ships (read-only):
 *   - `node_modules/@pascal-app/plugin-bones/data/wall-assemblies.json`
 *     (`version` 2026-08-14, keyed to the 2021 IRC), consumed by
 *     `src/engines/wall-layers.ts`.
 *   - `node_modules/@pascal-app/plugin-bones/src/engines/cmu.ts:59-60` for the
 *     actual CMU unit depth.
 * Each constant carries its citation. Anything NOT found in bones and not
 * covered by a standard we can name is marked `unverified` on the preset and
 * surfaced in the inspector — we do not invent thicknesses.
 *
 * bones' own disclaimer applies and is repeated here: this is a drafting aid,
 * not engineering. Values are typical/approximate — verify with the AHJ.
 *
 * ## Stack order
 *
 * Outside → inside: exterior finish, [air space], sheathing, framing, interior
 * finish. That is bones' `exterior.stackOrderInsideOut` read backwards
 * (2021 IRC R703.1 / R703.2 / R703.3).
 *
 * The weather-resistive barrier (IRC R703.2) is deliberately NOT a layer: bones
 * models it at 0.01 in actual (rendered 1/16 in "symbolic"). It has no drawable
 * thickness at plan scale and adding a symbolic one would make `wall.thickness`
 * disagree with reality. Same for the vapour retarder (bones records it at
 * thickness 0).
 *
 * ## Which side is exterior
 *
 * `wall.frontSide` / `wall.backSide` (schema `wall.ts`). `frontSide` is the
 * +normal side, where `normal = perp(end - start) = (-dy, dx)/L` — this is the
 * same convention `resolveWallSurfaceSides` writes with
 * (`packages/core/src/lib/space-detection.ts:825-872`) and the same "left" side
 * the miter code offsets by +halfThickness.
 *
 *   frontSide === 'exterior' && backSide !== 'exterior'  ->  exterior = +1
 *   backSide  === 'exterior' && frontSide !== 'exterior' ->  exterior = -1
 *   otherwise (both interior, both exterior, or unknown) ->  null
 *
 * Fallback when it is `null`: the stack is still drawn at its true total
 * thickness (thickness must never change because a room was not detected), the
 * exterior face is pinned to the +normal side, and `exteriorSideResolved`
 * reports the fallback so callers can say so. A wall with both sides interior
 * is a PARTITION and should carry a partition assembly — one with neither
 * `exterior` nor `sheathing`, whose interior finish is then applied to BOTH
 * faces and no cladding or sheathing is drawn (see `resolveWallAssembly`).
 */

import type { WallNode } from '../../schema'
import type { WallAssembly } from '../../schema/nodes/wall'
import { DEFAULT_WALL_THICKNESS } from './wall-footprint'
import { type Point2D, pointToKey, type WallMiterData } from './wall-mitering'

// ============================================================================
// UNITS
// ============================================================================

/** Inches → metres. Every citation below is in inches, as the code is. */
const IN = 0.0254
const inches = (value: number) => value * IN

// ============================================================================
// CITED LAYER THICKNESSES (metres)
// ============================================================================

/** 1/2 in gypsum board. 2021 IRC R702.3.5 + Table R702.3.5 (bones interior.layers). */
export const GYPSUM_HALF = inches(0.5)
/** 5/8 in gypsum board. 2021 IRC Table R702.3.5 (bones interior.gypsumThicknessOptionsIn). */
export const GYPSUM_FIVE_EIGHTHS = inches(0.625)
/** 7/16 in wood structural panel, field default. 2021 IRC Table R602.3(3) (bones exterior.sheathing). */
export const WSP_SHEATHING = inches(0.4375)
/** 1/2 in glass-mat gypsum sheathing. bones exterior.sheathing.gypsumSheathingOption (IRC R702.3.5 + Table R703.3(1)). */
export const GYPSUM_SHEATHING = inches(0.5)
/** 2x4 stud, actual 3-1/2 in. 2021 IRC R602.3 / Table R602.3(5) (bones interior.layers framing row). */
export const STUD_2X4 = inches(3.5)
/** 2x6 stud, actual 5-1/2 in. Same source as STUD_2X4 (bones exterior.baseLayers insulation row cites 5.5 in 2x6 bays). */
export const STUD_2X6 = inches(5.5)
/** Vinyl / wood lap siding bounding depth, 3/4 in. 2021 IRC R703.11 / R703.5 + Table R703.3(1) (bones claddings.vinyl / .wood). */
export const SIDING_LAP = inches(0.75)
/** Fiber cement lap board, 5/16 in board. 2021 IRC R703.10.2 + Table R703.3(1) (bones claddings.fiberCement). */
export const FIBER_CEMENT = inches(0.3125)
/** 3-coat cement plaster, 7/8 in. 2021 IRC R703.7 + Table R702.1(1) (bones claddings.stucco). */
export const STUCCO_3_COAT = inches(0.875)
/** Anchored brick wythe, nominal 4 in = 3-5/8 actual. 2021 IRC R703.8 + Table R703.3(1) (bones claddings.brickVeneer). */
export const BRICK_VENEER = inches(3.625)
/** Nominal 1 in air space behind brick. 2021 IRC Table R703.8.4(1) + R703.8.4.2 (bones claddings.brickVeneer). */
export const BRICK_AIR_SPACE = inches(1.0)
/** Actual depth of a nominal 8 in CMU unit, 7-5/8 in. ASTM C90 — bones `src/engines/cmu.ts:59-60` (`BLOCK_DEPTH_ACTUAL`). */
export const CMU_8_ACTUAL = inches(7.625)
/**
 * 1x3 furring strip laid flat, 3/4 in. UNVERIFIED as an assembly thickness:
 * bones only names 3/4 in vertical furring in passing, as a cladding
 * attachment over foam (R703.15), not as a CMU furring layer. 3/4 in is the
 * actual thickness of nominal 1x lumber.
 */
export const FURRING_1X = inches(0.75)
/**
 * Adhered stone veneer, 2-5/8 in. UNVERIFIED: bones ships no stone cladding
 * entry. 2-5/8 in is the maximum unit thickness for adhered masonry veneer,
 * but we have no cited bones value, so any preset using it is flagged.
 */
export const STONE_VENEER_UNVERIFIED = inches(2.625)

// ============================================================================
// RESOLVED LAYERS
// ============================================================================

export type WallAssemblyLayerRole =
  | 'exterior-finish'
  | 'air-gap'
  | 'sheathing'
  | 'framing'
  | 'interior-finish'

export type WallAssemblyLayer = {
  role: WallAssemblyLayerRole
  /** Human-readable material, used verbatim in the inspector and in poché keys. */
  material: string
  thickness: number
  /**
   * Distance from the EXTERIOR face of the whole stack to this layer's OUTER
   * boundary. The first layer is always 0; the last layer's
   * `offsetFromExteriorFace + thickness === total`.
   */
  offsetFromExteriorFace: number
}

export type ResolvedWallAssembly = {
  layers: WallAssemblyLayer[]
  total: number
  /** 'envelope' has cladding/sheathing, 'partition' does not, 'unspecified' = no assembly. */
  kind: 'envelope' | 'partition' | 'unspecified'
  /** +1 = exterior on the +normal (front) side, -1 = -normal (back), null = undetermined. */
  exteriorSide: 1 | -1 | null
  /** `exteriorSide` with the +normal fallback applied. Always a usable sign. */
  exteriorSideResolved: 1 | -1
}

export type WallAssemblySideSource = Pick<WallNode, 'frontSide' | 'backSide'>

/**
 * Which geometric side of the wall faces outdoors. See the module header for
 * the rule; `null` means "undetermined", not "interior".
 */
export function resolveWallExteriorSide(wall: WallAssemblySideSource): 1 | -1 | null {
  const front = wall.frontSide ?? 'unknown'
  const back = wall.backSide ?? 'unknown'
  if (front === 'exterior' && back !== 'exterior') return 1
  if (back === 'exterior' && front !== 'exterior') return -1
  return null
}

/** A stack with neither cladding nor sheathing is a partition (finish both faces). */
function isPartitionAssembly(assembly: WallAssembly): boolean {
  const hasExterior =
    (assembly.exterior?.thickness ?? 0) > 0 && assembly.exterior?.finish !== 'none'
  const hasSheathing =
    (assembly.sheathing?.thickness ?? 0) > 0 && assembly.sheathing?.material !== 'none'
  return !(hasExterior || hasSheathing)
}

function interiorThickness(assembly: WallAssembly): number {
  if (!assembly.interior || assembly.interior.finish === 'none') return 0
  return Math.max(0, assembly.interior.thickness)
}

/**
 * Total thickness of a stack, in metres. THE definition of `wall.thickness`
 * whenever an assembly is present.
 *
 * - envelope: exterior + sheathing + framing + interior
 * - partition (no exterior, no sheathing): interior + framing + interior
 */
export function assemblyThickness(assembly: WallAssembly): number {
  const framing = Math.max(0, assembly.framing?.depth ?? 0)
  const interior = interiorThickness(assembly)
  if (isPartitionAssembly(assembly)) return framing + interior * 2
  const exterior =
    assembly.exterior && assembly.exterior.finish !== 'none'
      ? Math.max(0, assembly.exterior.thickness)
      : 0
  const sheathing =
    assembly.sheathing && assembly.sheathing.material !== 'none'
      ? Math.max(0, assembly.sheathing.thickness)
      : 0
  return exterior + sheathing + framing + interior
}

const EXTERIOR_FINISH_LABEL: Record<string, string> = {
  siding: 'lap siding',
  stucco: '3-coat cement plaster',
  brick: 'brick veneer',
  stone: 'stone veneer',
  'fiber-cement': 'fiber cement lap siding',
  none: 'none',
}
const SHEATHING_LABEL: Record<string, string> = {
  osb: 'OSB sheathing',
  plywood: 'plywood sheathing',
  gypsum: 'gypsum sheathing',
  none: 'none',
}
const FRAMING_LABEL: Record<string, string> = {
  wood: 'wood studs',
  lgs: 'light-gauge steel studs',
  cmu: 'CMU',
  icf: 'ICF',
}
const INTERIOR_FINISH_LABEL: Record<string, string> = {
  drywall: 'gypsum board',
  plaster: 'plaster',
  none: 'none',
}

/**
 * Resolve a wall into its ordered layer stack, outside → inside.
 *
 * `layers` always sums exactly to `total`, and `total` is what
 * `wall.thickness` must hold. A wall with no `assembly` resolves to a single
 * `framing` layer of `wall.thickness` so callers have one code path.
 */
export function resolveWallAssembly(
  wall: Pick<WallNode, 'thickness' | 'assembly' | 'frontSide' | 'backSide'>,
): ResolvedWallAssembly {
  const exteriorSide = resolveWallExteriorSide(wall)
  const exteriorSideResolved: 1 | -1 = exteriorSide ?? 1
  const assembly = wall.assembly

  if (!assembly) {
    const total = wall.thickness ?? DEFAULT_WALL_THICKNESS
    return {
      layers: [
        {
          role: 'framing',
          material: 'unspecified',
          thickness: total,
          offsetFromExteriorFace: 0,
        },
      ],
      total,
      kind: 'unspecified',
      exteriorSide,
      exteriorSideResolved,
    }
  }

  const layers: WallAssemblyLayer[] = []
  let cursor = 0
  const push = (role: WallAssemblyLayerRole, material: string, thickness: number) => {
    if (thickness <= 0) return
    layers.push({ role, material, thickness, offsetFromExteriorFace: cursor })
    cursor += thickness
  }

  const partition = isPartitionAssembly(assembly)
  const interior = interiorThickness(assembly)
  const interiorMaterial = INTERIOR_FINISH_LABEL[assembly.interior?.finish ?? 'none'] ?? 'finish'

  if (partition) {
    // Both faces are interior: finish, framing, finish. No sheathing, no cladding.
    push('interior-finish', interiorMaterial, interior)
    push('framing', FRAMING_LABEL[assembly.framing.kind] ?? 'framing', assembly.framing.depth)
    push('interior-finish', interiorMaterial, interior)
  } else {
    if (
      assembly.exterior &&
      assembly.exterior.finish !== 'none' &&
      assembly.exterior.thickness > 0
    ) {
      const finish = assembly.exterior.finish
      const material = EXTERIOR_FINISH_LABEL[finish] ?? finish
      if (finish === 'brick' && assembly.exterior.thickness > BRICK_VENEER) {
        // Brick veneer is drawn as two layers: the wythe and the air space
        // behind it (IRC Table R703.8.4(1)). The stored thickness is the whole
        // assembly offset, so the remainder over 3-5/8 in is the air space.
        push('exterior-finish', material, BRICK_VENEER)
        push('air-gap', 'air space', assembly.exterior.thickness - BRICK_VENEER)
      } else {
        push('exterior-finish', material, assembly.exterior.thickness)
      }
    }
    if (
      assembly.sheathing &&
      assembly.sheathing.material !== 'none' &&
      assembly.sheathing.thickness > 0
    ) {
      push(
        'sheathing',
        SHEATHING_LABEL[assembly.sheathing.material] ?? assembly.sheathing.material,
        assembly.sheathing.thickness,
      )
    }
    push('framing', FRAMING_LABEL[assembly.framing.kind] ?? 'framing', assembly.framing.depth)
    push('interior-finish', interiorMaterial, interior)
  }

  return {
    layers,
    total: cursor,
    kind: partition ? 'partition' : 'envelope',
    exteriorSide,
    exteriorSideResolved,
  }
}

/**
 * The patch to apply when any layer changes: the assembly plus the re-derived
 * TOTAL thickness. Callers must never write one without the other.
 */
export function wallAssemblyPatch(assembly: WallAssembly): {
  assembly: WallAssembly
  thickness: number
} {
  return { assembly, thickness: assemblyThickness(assembly) }
}

// ============================================================================
// PRESETS
// ============================================================================

export type WallAssemblyPreset = {
  id: string
  label: string
  category: 'exterior' | 'interior' | 'masonry'
  assembly: WallAssembly
  /**
   * Present when at least one thickness in this preset could not be cited to
   * bones or to a named standard. The inspector shows this verbatim.
   */
  unverified?: string
}

export const WALL_ASSEMBLY_PRESETS: readonly WallAssemblyPreset[] = [
  {
    id: 'exterior-2x4-siding',
    label: 'Exterior 2x4 — lap siding',
    category: 'exterior',
    assembly: {
      preset: 'exterior-2x4-siding',
      exterior: { finish: 'siding', thickness: SIDING_LAP },
      sheathing: { material: 'osb', thickness: WSP_SHEATHING },
      framing: { kind: 'wood', depth: STUD_2X4 },
      interior: { finish: 'drywall', thickness: GYPSUM_HALF },
      cavityInsulation: 'batt, R per climate zone (IRC N1102.1.3)',
    },
  },
  {
    id: 'exterior-2x6-siding',
    label: 'Exterior 2x6 — lap siding',
    category: 'exterior',
    assembly: {
      preset: 'exterior-2x6-siding',
      exterior: { finish: 'siding', thickness: SIDING_LAP },
      sheathing: { material: 'osb', thickness: WSP_SHEATHING },
      framing: { kind: 'wood', depth: STUD_2X6 },
      interior: { finish: 'drywall', thickness: GYPSUM_HALF },
      cavityInsulation: 'batt, R per climate zone (IRC N1102.1.3)',
    },
  },
  {
    id: 'exterior-2x6-stucco',
    label: 'Exterior 2x6 — stucco',
    category: 'exterior',
    assembly: {
      preset: 'exterior-2x6-stucco',
      exterior: { finish: 'stucco', thickness: STUCCO_3_COAT },
      // bones flags glass-mat gypsum sheathing as the typical substrate under
      // stucco; kept structural (7/16 WSP) here because bracing normally is.
      sheathing: { material: 'osb', thickness: WSP_SHEATHING },
      framing: { kind: 'wood', depth: STUD_2X6 },
      interior: { finish: 'drywall', thickness: GYPSUM_HALF },
      cavityInsulation: 'batt, R per climate zone (IRC N1102.1.3)',
    },
  },
  {
    id: 'exterior-2x6-brick',
    label: 'Exterior 2x6 — brick veneer',
    category: 'exterior',
    assembly: {
      preset: 'exterior-2x6-brick',
      // 3-5/8 wythe + 1 in air space = bones' assemblyOffsetIn 4.625.
      exterior: { finish: 'brick', thickness: BRICK_VENEER + BRICK_AIR_SPACE },
      sheathing: { material: 'osb', thickness: WSP_SHEATHING },
      framing: { kind: 'wood', depth: STUD_2X6 },
      interior: { finish: 'drywall', thickness: GYPSUM_HALF },
      cavityInsulation: 'batt, R per climate zone (IRC N1102.1.3)',
    },
  },
  {
    id: 'interior-2x4-drywall',
    label: 'Interior 2x4 — drywall both sides',
    category: 'interior',
    // bones interior.totalThicknessIn = 4.5 in — this preset reproduces it.
    assembly: {
      preset: 'interior-2x4-drywall',
      framing: { kind: 'wood', depth: STUD_2X4 },
      interior: { finish: 'drywall', thickness: GYPSUM_HALF },
    },
  },
  {
    id: 'interior-2x6-plumbing',
    label: 'Interior 2x6 — plumbing wall',
    category: 'interior',
    assembly: {
      preset: 'interior-2x6-plumbing',
      framing: { kind: 'wood', depth: STUD_2X6 },
      interior: { finish: 'drywall', thickness: GYPSUM_HALF },
    },
  },
  {
    id: 'cmu-8-furred-drywall',
    label: 'CMU 8" — furring + drywall',
    category: 'masonry',
    assembly: {
      preset: 'cmu-8-furred-drywall',
      // The block is the structure; the furring rides on its inside face and is
      // modelled as the sheathing slot so the stack stays four layers deep.
      framing: { kind: 'cmu', depth: CMU_8_ACTUAL },
      sheathing: { material: 'none', thickness: 0 },
      exterior: { finish: 'none', thickness: 0 },
      interior: { finish: 'drywall', thickness: FURRING_1X + GYPSUM_HALF },
    },
    unverified:
      '1x3 furring at 3/4 in is nominal-lumber practice, not a bones-cited assembly layer; the furring and the 1/2 in board are drawn as one 1-1/4 in interior finish.',
  },
] as const

/**
 * The catalog material the 3D exterior face is skinned with for each
 * assembly cladding, when the wall has no painted exterior slot of its own.
 * This is what makes a wall that SAYS "lap siding" in its assembly LOOK like
 * lap siding in the viewer, the elevation and the section alike. Stone has
 * no catalog finish yet and 'none' is bare — both return null (drawn with the
 * plain wall default). Only `library:` refs, never an invented colour.
 */
export const WALL_FINISH_LIBRARY_REF: Record<string, string | null> = {
  siding: 'library:siding-lap-white',
  'fiber-cement': 'library:siding-lap-greige',
  stucco: 'library:concrete-stucco',
  brick: 'library:flooring-agedbrick',
  stone: null,
  none: null,
}

/** `library:` ref for the wall's assembly cladding, or null when it has none. */
export function wallAssemblyFinishRef(wall: Pick<WallNode, 'assembly'>): string | null {
  const finish = wall.assembly?.exterior?.finish
  if (!finish) return null
  return WALL_FINISH_LIBRARY_REF[finish] ?? null
}

export function getWallAssemblyPreset(id: string | undefined): WallAssemblyPreset | undefined {
  if (!id) return undefined
  return WALL_ASSEMBLY_PRESETS.find((preset) => preset.id === id)
}

/** True when the wall's assembly came from a preset we could not fully cite. */
export function wallAssemblyUnverifiedNote(wall: Pick<WallNode, 'assembly'>): string | undefined {
  return getWallAssemblyPreset(wall.assembly?.preset)?.unverified
}

// ============================================================================
// LAYER BOUNDARY OFFSETS
// ============================================================================

/**
 * Signed offsets from the wall CENTRELINE of every layer boundary, ordered from
 * the +normal face inward to the -normal face. Always `layers.length + 1`
 * entries; the first is `+total/2` and the last is `-total/2`.
 *
 * `drawnThickness` lets the 2D plan exaggerate thin walls (the editor scales
 * wall bodies for legibility) without the layers drifting out of the drawn
 * footprint: the whole stack is scaled by `drawnThickness / total`.
 */
export function wallLayerBoundaryOffsets(
  wall: Pick<WallNode, 'thickness' | 'assembly' | 'frontSide' | 'backSide'>,
  drawnThickness?: number,
): number[] {
  const resolved = resolveWallAssembly(wall)
  const total = resolved.total
  if (total <= 0) return []
  const scale = drawnThickness && drawnThickness > 0 ? drawnThickness / total : 1
  const half = (total * scale) / 2
  const sign = resolved.exteriorSideResolved

  // Cumulative depth from the exterior face → signed offset from centreline.
  const depths = [0, ...resolved.layers.map((l) => l.offsetFromExteriorFace + l.thickness)]
  const offsets = depths.map((depth) => sign * (half - depth * scale))
  // `sign === -1` produces an ascending list; the contract is descending from
  // the +normal face, so normalise.
  return offsets[0]! >= offsets[offsets.length - 1]! ? offsets : offsets.slice().reverse()
}

// ============================================================================
// OFFSET MITERING
// ============================================================================
//
// `calculateLevelMiters` (wall-mitering.ts) intersects each wall's ±halfT edge
// with its angular neighbour's opposite edge at a junction. The layer lines
// need exactly the same treatment at an ARBITRARY offset from the centreline,
// so `calculateLevelLayerMiters` re-runs that pairwise-adjacent-angle pass over
// the junction graph `calculateLevelMiters` already produced, once per boundary
// index instead of once per wall.
//
// PAIRING RULE (two walls with different assemblies, or different totals):
// boundaries are paired BY DEPTH FROM THE SHARED CORNER FACE. At a junction
// the left edge of wall A meets the right edge of wall B; both walls' faces on
// that side are depth 0, and each boundary of A terminates where it crosses
// the boundary of B at the NEAREST depth (and vice versa).
//   - Depth 0 always pairs with depth 0, so the outer faces reproduce the
//     existing footprint miter exactly.
//   - Two walls carrying the SAME assembly have a mutual mapping, so both
//     walls resolve each boundary to ONE shared point per corner.
//   - Two walls with DIFFERENT assemblies have no such bijection. Every line
//     still ends exactly ON a real material boundary of the neighbour (the way
//     a partition's board dies into an exterior wall's board line) — nothing
//     dangles — but the two walls' mid-stack lines may end at different points
//     on that shared line. That is a drawing decision, stated plainly here.
//   - When a boundary is a candidate at BOTH corners of a joint (3+ wall
//     junctions), the corner it is NEARER to wins (priority = its index in
//     from that corner's face).
//
// T-JUNCTIONS: identical to the outer miter. The through wall is a
// `passthrough` entry and receives no intersections — its layer lines run
// unbroken past the junction, which is how sheathing and board are actually
// hung. The butting stem's lines stop on the through wall's corresponding
// boundary line, because that is the line they are intersected against.
//
// MITER LIMIT: the same runaway-spike guard as the outer miter, using the
// half-thickness of the two walls. A rejected joint falls back to the square
// (butt) boundary point, exactly as the footprint does.

const LAYER_MITER_LIMIT = 10
const PARALLEL_EPSILON = 1e-9

type LineEquation = { a: number; b: number; c: number }

function lineFrom(point: Point2D, direction: Point2D): LineEquation {
  const a = -direction.y
  const b = direction.x
  return { a, b, c: -(a * point.x + b * point.y) }
}

function intersect(l1: LineEquation, l2: LineEquation): Point2D | null {
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < PARALLEL_EPSILON) return null
  const x = (l1.b * l2.c - l2.b * l1.c) / det
  const y = (l2.a * l1.c - l1.a * l2.c) / det
  if (!(Number.isFinite(x) && Number.isFinite(y))) return null
  return { x, y }
}

/** Per-wall, per-junction resolved boundary points, indexed from the +normal face. */
export type WallLayerMiterData = {
  /** `wallId -> junctionKey -> points`, indexed from the wall's +normal face. */
  byWall: Map<string, Map<string, (Point2D | null)[]>>
}

type LayerEntry = {
  wallId: string
  angle: number
  /** Offsets in ENTRY space (+ = left of the outgoing direction), descending. */
  offsets: number[]
  direction: Point2D
  isPassthrough: boolean
  halfThickness: number
  /** True when the entry direction equals the wall's own start→end direction. */
  forward: boolean
}

/**
 * Compute mitered layer-boundary points for every wall on a level.
 *
 * `walls` and `miterData` must be the same pair used for the footprint (the
 * floor plan exaggerates thin walls, so it passes the exaggerated list).
 * `getOffsets` returns each wall's boundary offsets from its centreline,
 * descending from +normal — i.e. `wallLayerBoundaryOffsets`.
 */
export function calculateLevelLayerMiters(
  walls: readonly WallNode[],
  miterData: WallMiterData,
  getOffsets: (wall: WallNode) => number[],
): WallLayerMiterData {
  const byWall: WallLayerMiterData['byWall'] = new Map()
  const offsetCache = new Map<string, number[]>()
  const offsetsFor = (wall: WallNode) => {
    let cached = offsetCache.get(wall.id)
    if (!cached) {
      cached = getOffsets(wall)
      offsetCache.set(wall.id, cached)
    }
    return cached
  }
  const known = new Set(walls.map((w) => w.id))

  for (const [junctionKey, junction] of miterData.junctions.entries()) {
    const entries: LayerEntry[] = []

    for (const { wall, endType } of junction.connectedWalls) {
      if (!known.has(wall.id)) continue
      const offsets = offsetsFor(wall)
      if (offsets.length < 2) continue
      const halfThickness = Math.abs(offsets[0]!)
      const d = { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
      const forwardDirs: Array<{ v: Point2D; forward: boolean }> =
        endType === 'passthrough'
          ? [
              { v: d, forward: true },
              { v: { x: -d.x, y: -d.y }, forward: false },
            ]
          : endType === 'start'
            ? [{ v: d, forward: true }]
            : [{ v: { x: -d.x, y: -d.y }, forward: false }]

      for (const { v, forward } of forwardDirs) {
        const length = Math.hypot(v.x, v.y)
        if (length < 1e-9) continue
        // Entry space: +normal of the OUTGOING direction. For a reversed entry
        // that normal is the wall's -normal, so the offsets flip sign and the
        // list reverses to stay descending.
        const entryOffsets = forward
          ? offsets.slice()
          : offsets
              .slice()
              .reverse()
              .map((o) => -o)
        entries.push({
          wallId: wall.id,
          angle: Math.atan2(v.y, v.x),
          offsets: entryOffsets,
          direction: { x: v.x / length, y: v.y / length },
          isPassthrough: endType === 'passthrough',
          halfThickness,
          forward,
        })
      }
    }

    if (entries.length < 2) continue

    entries.sort((a, b) => {
      const byAngle = a.angle - b.angle
      if (byAngle !== 0) return byAngle
      return a.wallId < b.wallId ? -1 : a.wallId > b.wallId ? 1 : 0
    })

    const meeting = junction.meetingPoint
    // A junction with 3+ walls offers each interior boundary TWO candidate
    // termination points — one against the CCW neighbour (via the left-edge
    // pairing) and one against the CW neighbour (right-edge pairing). We keep
    // the candidate from the pairing whose own outer face the boundary is
    // NEARER to: `priority` counts boundaries in from that pairing's face, so 0
    // is an outer face (which reproduces the existing footprint miter exactly)
    // and larger numbers lose. At an ordinary 2-wall corner both pairings are
    // the same line pair and therefore the same point, so the rule is a no-op.
    const priorities = new Map<string, number[]>()
    const store = (entry: LayerEntry, entryIndex: number, priority: number, point: Point2D) => {
      if (entry.isPassthrough) return
      const count = offsetCache.get(entry.wallId)?.length ?? 0
      if (count === 0) return
      let perWall = byWall.get(entry.wallId)
      if (!perWall) {
        perWall = new Map()
        byWall.set(entry.wallId, perWall)
      }
      let slot = perWall.get(junctionKey)
      if (!slot) {
        slot = new Array(count).fill(null)
        perWall.set(junctionKey, slot)
      }
      const priorityKey = `${entry.wallId}|${junctionKey}`
      let slotPriorities = priorities.get(priorityKey)
      if (!slotPriorities) {
        slotPriorities = new Array(count).fill(Number.POSITIVE_INFINITY)
        priorities.set(priorityKey, slotPriorities)
      }
      // Entry-space index → wall-space index (from the +normal face).
      const wallIndex = entry.forward ? entryIndex : count - 1 - entryIndex
      if (wallIndex < 0 || wallIndex >= count) return
      if (priority >= slotPriorities[wallIndex]!) return
      slotPriorities[wallIndex] = priority
      slot[wallIndex] = point
    }

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!
      const b = entries[(i + 1) % entries.length]!
      if (a === b) continue
      const maxMiter = LAYER_MITER_LIMIT * Math.max(a.halfThickness, b.halfThickness)
      const nA = { x: -a.direction.y, y: a.direction.x }
      const nB = { x: -b.direction.y, y: b.direction.x }

      // Depth of each boundary in from the face this corner is made of:
      // a's LEFT face (entry index 0) and b's RIGHT face (entry index len-1).
      const depthA = a.offsets.map((o) => a.offsets[0]! - o)
      const depthB = b.offsets.map((o) => o - b.offsets[b.offsets.length - 1]!)
      const nearest = (depths: number[], target: number) => {
        let best = 0
        let bestDelta = Number.POSITIVE_INFINITY
        for (let i = 0; i < depths.length; i++) {
          const delta = Math.abs(depths[i]! - target)
          if (delta < bestDelta) {
            bestDelta = delta
            best = i
          }
        }
        return best
      }
      const lineFor = (entry: LayerEntry, n: Point2D, index: number) =>
        lineFrom(
          {
            x: meeting.x + n.x * entry.offsets[index]!,
            y: meeting.y + n.y * entry.offsets[index]!,
          },
          entry.direction,
        )
      const joint = (indexA: number, indexB: number): Point2D | null => {
        const p = intersect(lineFor(a, nA, indexA), lineFor(b, nB, indexB))
        if (!p) return null
        const dx = p.x - meeting.x
        const dy = p.y - meeting.y
        if (dx * dx + dy * dy > maxMiter * maxMiter) return null
        return p
      }
      // Each of a's boundaries dies onto b's boundary at the nearest depth from
      // the shared face, and vice versa. When the two walls carry the same
      // assembly the mapping is mutual and both walls resolve to ONE point per
      // boundary; when they differ, every line still terminates on a real
      // material boundary of the neighbour instead of dangling.
      for (let k = 0; k < a.offsets.length; k++) {
        const p = joint(k, nearest(depthB, depthA[k]!))
        if (p) store(a, k, k, p)
      }
      for (let j = 0; j < b.offsets.length; j++) {
        const p = joint(nearest(depthA, depthB[j]!), j)
        if (p) store(b, j, b.offsets.length - 1 - j, p)
      }
    }
  }

  return { byWall }
}

export type WallLayerPolyline = {
  role: WallAssemblyLayerRole | 'face'
  /** Index from the +normal face; 0 and `count - 1` are the two outer faces. */
  index: number
  offset: number
  start: Point2D
  end: Point2D
}

/**
 * The drawn layer boundary lines for one wall, already mitered at both ends.
 * Index 0 and the last index are the outer faces (already drawn by the
 * footprint polygon); callers normally skip them and draw the interior ones.
 *
 * `role` names the layer OUTSIDE the boundary (the one nearer the +normal face
 * for a front-exterior wall), so a boundary can be styled by what it separates.
 */
export function getWallLayerPolylines(
  wall: WallNode,
  layerMiters: WallLayerMiterData,
  offsets: number[],
): WallLayerPolyline[] {
  if (offsets.length < 2) return []
  const start: Point2D = { x: wall.start[0], y: wall.start[1] }
  const end: Point2D = { x: wall.end[0], y: wall.end[1] }
  const d = { x: end.x - start.x, y: end.y - start.y }
  const length = Math.hypot(d.x, d.y)
  if (length < 1e-9) return []
  const n = { x: -d.y / length, y: d.x / length }

  const perWall = layerMiters.byWall.get(wall.id)
  // Both slots are indexed in wall space (from the +normal face) — `store`
  // normalises the reversed end-junction entry for us.
  const startSlot = perWall?.get(pointToKey(start))
  const endSlot = perWall?.get(pointToKey(end))

  const resolved = resolveWallAssembly(wall)
  const rolesFromFront: (WallAssemblyLayerRole | 'face')[] =
    resolved.exteriorSideResolved === 1
      ? resolved.layers.map((l) => l.role)
      : resolved.layers.map((l) => l.role).reverse()

  const out: WallLayerPolyline[] = []
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i]!
    const fallbackStart: Point2D = { x: start.x + n.x * offset, y: start.y + n.y * offset }
    const fallbackEnd: Point2D = { x: end.x + n.x * offset, y: end.y + n.y * offset }
    out.push({
      role: i === 0 ? 'face' : (rolesFromFront[i - 1] ?? 'face'),
      index: i,
      offset,
      start: startSlot?.[i] ?? fallbackStart,
      end: endSlot?.[i] ?? fallbackEnd,
    })
  }
  return out
}

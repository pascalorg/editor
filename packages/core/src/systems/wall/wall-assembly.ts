/**
 * Wall assemblies — real layered stacks with true thicknesses, plus the
 * offset-miter geometry that lets the layer boundaries be drawn on the 2D plan
 * with clean corners.
 *
 * ## Where the numbers come from
 *
 * Every thickness below is keyed to the 2021 IRC (ASTM C90 for the CMU unit
 * depth), and each constant carries its citation. Anything not covered by a
 * standard we can name is marked `unverified` on the preset and surfaced in
 * the inspector — we do not invent thicknesses.
 *
 * This is a drafting aid, not engineering. Values are typical/approximate — verify with the AHJ.
 *
 * ## Stack order
 *
 * Outside → inside: exterior finish, [air space], sheathing, framing, interior
 * finish (2021 IRC R703.1 / R703.2 / R703.3).
 *
 * The weather-resistive barrier (IRC R703.2) is deliberately NOT a layer: at
 * about 0.01 in it has no drawable thickness at plan scale, and adding a
 * symbolic one would make `wall.thickness` disagree with reality. Same for the
 * vapour retarder.
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
import type { Assembly, AssemblyLayer } from '../../schema/assembly'
import { WallAssembly } from '../../schema/nodes/wall'
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

/** 1/2 in gypsum board. 2021 IRC R702.3.5 + Table R702.3.5. */
export const GYPSUM_HALF = inches(0.5)
/** 5/8 in gypsum board. 2021 IRC Table R702.3.5. */
export const GYPSUM_FIVE_EIGHTHS = inches(0.625)
/** 7/16 in wood structural panel, field default. 2021 IRC Table R602.3(3). */
export const WSP_SHEATHING = inches(0.4375)
/** 1/2 in glass-mat gypsum sheathing. 2021 IRC R702.3.5 + Table R703.3(1). */
export const GYPSUM_SHEATHING = inches(0.5)
/** 2x4 stud, actual 3-1/2 in. 2021 IRC R602.3 / Table R602.3(5). */
export const STUD_2X4 = inches(3.5)
/** 2x6 stud, actual 5-1/2 in. Same source as STUD_2X4. */
export const STUD_2X6 = inches(5.5)
/** Vinyl / wood lap siding bounding depth, 3/4 in. 2021 IRC R703.11 / R703.5 + Table R703.3(1). */
export const SIDING_LAP = inches(0.75)
/** Fiber cement lap board, 5/16 in board. 2021 IRC R703.10.2 + Table R703.3(1). */
export const FIBER_CEMENT = inches(0.3125)
/** 3-coat cement plaster, 7/8 in. 2021 IRC R703.7 + Table R702.1(1). */
export const STUCCO_3_COAT = inches(0.875)
/** Anchored brick wythe, nominal 4 in = 3-5/8 actual. 2021 IRC R703.8 + Table R703.3(1). */
export const BRICK_VENEER = inches(3.625)
/** Nominal 1 in air space behind brick. 2021 IRC Table R703.8.4(1) + R703.8.4.2. */
export const BRICK_AIR_SPACE = inches(1.0)
/** Actual depth of a nominal 8 in CMU unit, 7-5/8 in. ASTM C90. */
export const CMU_8_ACTUAL = inches(7.625)
/**
 * 1x3 furring strip laid flat, 3/4 in. UNVERIFIED as an assembly thickness:
 * the code names 3/4 in vertical furring only as a cladding attachment over
 * foam (R703.15), not as a CMU furring layer. 3/4 in is the actual thickness
 * of nominal 1x lumber.
 */
export const FURRING_1X = inches(0.75)
/**
 * Adhered stone veneer, 2-5/8 in. UNVERIFIED: 2-5/8 in is the maximum unit
 * thickness for adhered masonry veneer, not a cited assembly value, so any
 * preset using it is flagged.
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

/** WS5's rule: a stack with neither cladding nor sheathing is a partition (finish both faces). */
function isLegacyPartition(assembly: WallAssembly): boolean {
  const hasExterior =
    (assembly.exterior?.thickness ?? 0) > 0 && assembly.exterior?.finish !== 'none'
  const hasSheathing =
    (assembly.sheathing?.thickness ?? 0) > 0 && assembly.sheathing?.material !== 'none'
  return !(hasExterior || hasSheathing)
}

/** The ids `wallAssemblyFromLegacy` gives each role. */
const LEGACY_LAYER_IDS: Partial<Record<AssemblyLayer['role'], readonly string[]>> = {
  finish: ['exterior'],
  air: ['air-space'],
  sheathing: ['sheathing'],
  structure: ['framing'],
  lining: ['interior', 'interior-back'],
}

/** Whether a stored value is a WS5 `WallAssembly` (the shape #937 wrote) rather than F2. */
export function isLegacyWallAssembly(value: unknown): value is WallAssembly {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return !Array.isArray(record.layers) && WallAssembly.safeParse(value).success
}

/**
 * A WS5 `WallAssembly` as F2 layers (owner ruling 2026-09-27): exterior →
 * `finish`, sheathing → `sheathing`, framing → the `core` structure layer,
 * interior → `lining`, listed from the exterior face (`face: 'exterior'`) so the
 * stack keeps following the outside when rooms are re-detected. A brick
 * exterior thicker than one wythe splits into the veneer and its air space,
 * and a partition carries its interior finish on both faces, as WS5 drew them.
 * `'none'` slots are dropped; zero-thickness ones are kept (they draw nothing).
 * The layer sum is the WS5 total, so the wall's `thickness` does not change.
 */
export function wallAssemblyFromLegacy(legacy: WallAssembly): Assembly {
  const layers: AssemblyLayer[] = []
  const exterior = legacy.exterior
  if (exterior && exterior.finish !== 'none') {
    if (exterior.finish === 'brick' && exterior.thickness > BRICK_VENEER) {
      layers.push({ id: 'exterior', role: 'finish', material: 'brick', thickness: BRICK_VENEER })
      layers.push({
        id: 'air-space',
        role: 'air',
        thickness: exterior.thickness - BRICK_VENEER,
      })
    } else {
      layers.push({
        id: 'exterior',
        role: 'finish',
        material: exterior.finish,
        thickness: exterior.thickness,
      })
    }
  }
  const sheathing = legacy.sheathing
  if (sheathing && sheathing.material !== 'none') {
    layers.push({
      id: 'sheathing',
      role: 'sheathing',
      material: sheathing.material,
      thickness: sheathing.thickness,
    })
  }
  const interior =
    legacy.interior && legacy.interior.finish !== 'none'
      ? ({
          role: 'lining',
          material: legacy.interior.finish,
          thickness: legacy.interior.thickness,
        } as const)
      : null
  const partition = isLegacyPartition(legacy)
  if (partition && interior) layers.push({ id: 'interior-back', ...interior })
  layers.push({
    id: 'framing',
    role: 'structure',
    core: true,
    material: legacy.framing.kind,
    thickness: legacy.framing.depth,
  })
  if (interior) layers.push({ id: 'interior', ...interior })
  return {
    layers,
    face: 'exterior',
    ...(legacy.preset !== undefined ? { presetId: legacy.preset } : {}),
    ...(legacy.cavityInsulation !== undefined ? { cavityInsulation: legacy.cavityInsulation } : {}),
  }
}

/**
 * The WS5 view of an F2 stack that has one (what `wallAssemblyFromLegacy`
 * produces), for the inspector's cladding / sheathing / framing / interior
 * editor and for plugins written against WS5; `null` for any other stack.
 * Round-trips with `wallAssemblyFromLegacy` without loss.
 */
export function wallAssemblyToLegacy(assembly: Assembly): WallAssembly | null {
  if (assembly.face !== 'exterior' || assembly.backing?.length) return null
  // Only a stack WS5 fully describes round-trips: every layer with its
  // canonical id and nothing WS5 would drop (a source ref, a slot, returns,
  // display). Anything else is shown read-only instead of rebuilt.
  const lossless = assembly.layers.every(
    (layer) =>
      LEGACY_LAYER_IDS[layer.role]?.includes(layer.id) &&
      layer.src === undefined &&
      layer.slot === undefined &&
      layer.returns === undefined &&
      layer.display === undefined,
  )
  if (!lossless) return null
  const layers = [...assembly.layers]
  const take = (role: AssemblyLayer['role']) =>
    layers[0]?.role === role ? layers.shift() : undefined
  const legacy: WallAssembly = {
    framing: { kind: 'wood', depth: 0 },
    ...(assembly.presetId !== undefined ? { preset: assembly.presetId } : {}),
    ...(assembly.cavityInsulation !== undefined
      ? { cavityInsulation: assembly.cavityInsulation }
      : {}),
  }
  const finish = take('finish')
  if (finish) {
    const air = finish.material === 'brick' ? take('air') : undefined
    legacy.exterior = {
      finish: finish.material as NonNullable<WallAssembly['exterior']>['finish'],
      thickness: finish.thickness + (air?.thickness ?? 0),
    }
  }
  const sheathing = take('sheathing')
  if (sheathing) {
    legacy.sheathing = {
      material: sheathing.material as NonNullable<WallAssembly['sheathing']>['material'],
      thickness: sheathing.thickness,
    }
  }
  const outerLining = take('lining')
  const framing = take('structure')
  if (!framing?.core) return null
  legacy.framing = {
    kind: framing.material as WallAssembly['framing']['kind'],
    depth: framing.thickness,
  }
  const lining = take('lining')
  if (layers.length > 0) return null
  if (lining) {
    legacy.interior = {
      finish: lining.material as NonNullable<WallAssembly['interior']>['finish'],
      thickness: lining.thickness,
    }
  }
  if (outerLining) {
    const same =
      lining?.material === outerLining.material && lining?.thickness === outerLining.thickness
    if (!same || !isLegacyPartition(legacy)) return null
  }
  if (!WallAssembly.safeParse(legacy).success) return null
  // A familiar role sequence can still gain a partition lining, split brick
  // differently or rename a layer when edited through the WS5 controls.
  const roundTrip = wallAssemblyFromLegacy(legacy)
  if (roundTrip.layers.length !== assembly.layers.length) return null
  const sameLayers = assembly.layers.every((layer, index) => {
    const restored = roundTrip.layers[index]!
    return (
      restored.id === layer.id &&
      restored.role === layer.role &&
      restored.core === layer.core &&
      restored.material === layer.material &&
      Math.abs(restored.thickness - layer.thickness) < 1e-12
    )
  })
  if (!sameLayers) return null
  return legacy
}

/** Total thickness of a stack, in metres: THE value `wall.thickness` holds. */
export function assemblyThickness(assembly: Assembly): number {
  return assembly.layers.reduce((total, layer) => total + Math.max(0, layer.thickness), 0)
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

/** An F2 layer as the WS5 drawing role and its inspector / poché label. */
function drawnLayer(layer: AssemblyLayer): { role: WallAssemblyLayerRole; material: string } {
  const material = layer.material
  switch (layer.role) {
    case 'finish':
      return {
        role: 'exterior-finish',
        material: (material && EXTERIOR_FINISH_LABEL[material]) ?? material ?? 'finish',
      }
    case 'air':
      return { role: 'air-gap', material: 'air space' }
    case 'lining':
      return {
        role: 'interior-finish',
        material: (material && INTERIOR_FINISH_LABEL[material]) ?? 'finish',
      }
    case 'sheathing':
    case 'substrate':
    case 'membrane':
    case 'underlay':
      return {
        role: 'sheathing',
        material: (material && SHEATHING_LABEL[material]) ?? material ?? layer.role,
      }
    default:
      return {
        role: 'framing',
        material:
          (material && FRAMING_LABEL[material]) ??
          material ??
          (layer.core ? 'framing' : layer.role),
      }
  }
}

/** The wall's F2 layers ordered from the exterior face, with the side that faces out. */
function layersOutsideIn(wall: Pick<WallNode, 'assembly' | 'frontSide' | 'backSide'>) {
  const exteriorSide = resolveWallExteriorSide(wall)
  const exteriorSideResolved: 1 | -1 = exteriorSide ?? 1
  const listed = wall.assembly?.layers ?? []
  // A front-listed stack reads outside-in when the exterior is the front face.
  const layers =
    wall.assembly?.face === 'exterior' || exteriorSideResolved === 1
      ? listed
      : [...listed].reverse()
  return { layers, exteriorSide, exteriorSideResolved }
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
  const { layers: f2, exteriorSide, exteriorSideResolved } = layersOutsideIn(wall)

  if (!wall.assembly) {
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
  let envelope = false
  for (const layer of f2) {
    if (!(layer.thickness > 0)) continue
    const drawn = drawnLayer(layer)
    if (drawn.role === 'exterior-finish' || drawn.role === 'sheathing') envelope = true
    layers.push({ ...drawn, thickness: layer.thickness, offsetFromExteriorFace: cursor })
    cursor += layer.thickness
  }

  return {
    layers,
    total: cursor,
    kind: envelope ? 'envelope' : 'partition',
    exteriorSide,
    exteriorSideResolved,
  }
}

/**
 * The patch to apply when any layer changes: the assembly plus the re-derived
 * TOTAL thickness. Callers must never write one without the other.
 */
export function wallAssemblyPatch(assembly: Assembly): {
  assembly: Assembly
  thickness: number
} {
  return { assembly, thickness: assemblyThickness(assembly) }
}

// ============================================================================
// PRESETS
// ============================================================================

type LegacyWallAssemblyPreset = {
  id: string
  label: string
  category: 'exterior' | 'interior' | 'masonry'
  assembly: WallAssembly
  /**
   * Present when at least one thickness in this preset could not be cited to
   * a named standard. The inspector shows this verbatim.
   */
  unverified?: string
}

const LEGACY_WALL_ASSEMBLY_PRESETS: readonly LegacyWallAssemblyPreset[] = [
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
      // Glass-mat gypsum sheathing is the typical substrate under stucco;
      // kept structural (7/16 WSP) here because bracing normally is.
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
      // 3-5/8 wythe + 1 in air space = a 4.625 in assembly offset.
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
    // 4.5 in total, the typical 2x4 partition.
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
    id: 'exterior-cmu-stucco',
    label: 'Exterior CMU 8" — stucco',
    category: 'masonry',
    assembly: {
      preset: 'exterior-cmu-stucco',
      // The Florida block wall: 3-coat stucco direct on the block outside,
      // 1x furring + 1/2 in gypsum inside; the block is the structure.
      framing: { kind: 'cmu', depth: CMU_8_ACTUAL },
      sheathing: { material: 'none', thickness: 0 },
      exterior: { finish: 'stucco', thickness: STUCCO_3_COAT },
      interior: { finish: 'drywall', thickness: FURRING_1X + GYPSUM_HALF },
    },
    unverified:
      '1x3 furring at 3/4 in is nominal-lumber practice, not a code-cited assembly layer; the furring and the 1/2 in board are drawn as one 1-1/4 in interior finish.',
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
      '1x3 furring at 3/4 in is nominal-lumber practice, not a code-cited assembly layer; the furring and the 1/2 in board are drawn as one 1-1/4 in interior finish.',
  },
] as const

export type WallAssemblyPreset = Omit<LegacyWallAssemblyPreset, 'assembly'> & {
  /** The stack as F2 layers, listed from the exterior face. */
  assembly: Assembly
}

/** WS5's cited presets, as F2 stacks (`wallAssemblyFromLegacy`). */
export const WALL_ASSEMBLY_PRESETS: readonly WallAssemblyPreset[] =
  LEGACY_WALL_ASSEMBLY_PRESETS.map((preset) => ({
    ...preset,
    assembly: wallAssemblyFromLegacy(preset.assembly),
  }))

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

/** The material kind of the wall's outermost cladding (`siding`, `stucco`, …), if it declares one. */
export function wallAssemblyExteriorFinish(
  wall: Pick<WallNode, 'assembly' | 'frontSide' | 'backSide'>,
): string | undefined {
  return layersOutsideIn(wall).layers.find((layer) => layer.role === 'finish')?.material
}

/** The wall's structural core: its depth and framing kind (`wood`, `lgs`, `cmu`, `icf`), if declared. */
export function wallAssemblyFraming(
  wall: Pick<WallNode, 'assembly'>,
): { depth: number; kind?: string } | undefined {
  const core = wall.assembly?.layers.find((layer) => layer.core)
  if (!core) return undefined
  return { depth: core.thickness, ...(core.material ? { kind: core.material } : {}) }
}

/** `library:` ref for the wall's assembly cladding, or null when it has none. */
export function wallAssemblyFinishRef(
  wall: Pick<WallNode, 'assembly' | 'frontSide' | 'backSide'>,
): string | null {
  const finish = wallAssemblyExteriorFinish(wall)
  if (!finish) return null
  return WALL_FINISH_LIBRARY_REF[finish] ?? null
}

export function getWallAssemblyPreset(id: string | undefined): WallAssemblyPreset | undefined {
  if (!id) return undefined
  return WALL_ASSEMBLY_PRESETS.find((preset) => preset.id === id)
}

/** True when the wall's assembly came from a preset we could not fully cite. */
export function wallAssemblyUnverifiedNote(wall: Pick<WallNode, 'assembly'>): string | undefined {
  return getWallAssemblyPreset(wall.assembly?.presetId)?.unverified
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
  if (!walls.some((wall) => wall.assembly)) return { byWall }
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

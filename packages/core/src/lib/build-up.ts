import type {
  CeilingBuildUp,
  NominalLumber,
  RoofBuildUp,
  RoofingKind,
  RoofStructure,
  UnderlaymentKind,
} from '../schema/build-up'
import type { CeilingNode } from '../schema/nodes/ceiling'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resolveCeilingHeight } from '../services/level-height'
import { CEILING_CLAMP_MARGIN, getCoveringSlabUndersideAt } from '../services/storey'

const inches = (value: number) => value * 0.0254

/**
 * Actual depth of dressed lumber (2021 IRC R602.3 / ALSC PS 20): what a
 * rafter, truss chord or ceiling joist of that size adds to its layer.
 */
export const LUMBER_DEPTH: Record<NominalLumber, number> = {
  '2x4': inches(3.5),
  '2x6': inches(5.5),
  '2x8': inches(7.25),
  '2x10': inches(9.25),
  '2x12': inches(11.25),
}

/**
 * Typical installed thickness of each roofing, the envelope the plane draws as
 * its covering: two courses of shingle at the laps, a tile's profile, a seam's
 * height.
 */
export const ROOFING_THICKNESS: Record<RoofingKind, number> = {
  'asphalt-3-tab': inches(0.25),
  'architectural-shingle': inches(0.5),
  'standing-seam-metal': inches(1),
  'concrete-tile': inches(2),
  'clay-tile': inches(2.5),
  'wood-shake': inches(0.75),
  slate: inches(0.5),
}

export const UNDERLAYMENT_THICKNESS: Record<UnderlaymentKind, number> = {
  'felt-15': inches(0.03),
  'felt-30': inches(0.05),
  synthetic: inches(0.02),
  'ice-and-water': inches(0.04),
}

/** Roof sheathing and attic decking panels, thinnest first. */
export const PANEL_THICKNESSES: readonly number[] = [
  7 / 16,
  15 / 32,
  1 / 2,
  19 / 32,
  5 / 8,
  3 / 4,
].map(inches)

/** Framing spacings on centre: 12, 16, 19.2 and 24 in. */
export const FRAMING_SPACINGS: readonly number[] = [12, 16, 19.2, 24].map(inches)

export const DRYWALL_THICKNESSES: readonly number[] = [0.5, 0.625].map(inches)

/** Three-coat plaster on lath. */
export const PLASTER_THICKNESS = inches(0.875)
export const WOOD_PLANK_THICKNESS = inches(0.75)

/** Batt and blown fill the framing cavity (and mound over it when deeper); rigid board adds its own. */
function framedDepth(
  framingDepth: number,
  insulation: { kind: string; thickness: number } | undefined,
): number {
  if (!insulation) return framingDepth
  if (insulation.kind === 'rigid') return framingDepth + insulation.thickness
  return Math.max(framingDepth, insulation.thickness)
}

/**
 * How deep a roof plane's structure stands over the plate plane its deck rises
 * from: a rafter's depth, its underside on the plates; a truss two chord
 * depths, its top chord on the bottom chord at the heel. The heel is plumb, a
 * chord's depth times the slope's cosine square to it, so two depths are the
 * most it takes: on a pitch θ the top chords sit d(1 − cos θ) under the
 * sheathing, never through it.
 */
export function roofStructureDepth(structure: RoofStructure): number {
  const depth = LUMBER_DEPTH[structure.size]
  return structure.system === 'trusses' ? 2 * depth : depth
}

/**
 * The two thicknesses a roof plane draws with: `deck` (finish, structure,
 * insulation and sheathing) and `covering` (roofing and underlayment).
 */
export function roofBuildUpDepths(buildUp: RoofBuildUp): { deck: number; covering: number } {
  return {
    deck:
      (buildUp.finish?.thickness ?? 0) +
      framedDepth(roofStructureDepth(buildUp.structure), buildUp.insulation) +
      buildUp.sheathing.thickness,
    covering: buildUp.roofing.thickness + (buildUp.underlayment?.thickness ?? 0),
  }
}

/**
 * The patch that sets a roof plane's layers: the build-up and the deck and
 * covering thicknesses it derives, together. A writer never sets one without
 * the others.
 */
export function roofBuildUpPatch(buildUp: RoofBuildUp): {
  buildUp: RoofBuildUp
  deckThickness: number
  shingleThickness: number
} {
  const { deck, covering } = roofBuildUpDepths(buildUp)
  return { buildUp, deckThickness: deck, shingleThickness: covering }
}

/**
 * The layers a plane without any is drawn as: the default preset over the framing its deck
 * holds, rafters whose depth with the preset's sheathing makes it (a generated roof's 2x6
 * rafters), else the default preset itself: its trusses on their heel, or the one chord the
 * schema's 0.100 m deck held before the heel counted. "Edit layers" writes them, the deck
 * unchanged where it matched and deepened by the heel on that old deck; Bones frames such a
 * plane by them, so its rafters fit the deck drawn until a roof choice writes the plane layers of
 * its own.
 */
export function roofBuildUpOfDeck(deckThickness: number): RoofBuildUp {
  const preset = ROOF_BUILD_UP_PRESETS[0]!.buildUp
  const framing = deckThickness - preset.sheathing.thickness - (preset.finish?.thickness ?? 0)
  if (Math.abs(roofStructureDepth(preset.structure) - framing) < 1e-3) return preset
  const size = (Object.keys(LUMBER_DEPTH) as NominalLumber[]).find(
    (lumber) => Math.abs(LUMBER_DEPTH[lumber] - framing) < 1e-3,
  )
  if (!size || size === preset.structure.size) return preset
  const { presetId: _preset, ...layers } = preset
  return { ...layers, structure: { system: 'rafters', size, spacing: preset.structure.spacing } }
}

/** A ceiling's thickness, up from its finished underside. */
export function ceilingBuildUpThickness(buildUp: CeilingBuildUp): number {
  return (
    (buildUp.finish?.thickness ?? 0) +
    framedDepth(buildUp.framing ? LUMBER_DEPTH[buildUp.framing.size] : 0, buildUp.insulation) +
    (buildUp.decking?.thickness ?? 0)
  )
}

/**
 * How far above its underside a ceiling's upper face stands: its build-up's
 * thickness, stopped short of the floor of the level above (a slab covering
 * any vertex or the centroid, as the height clamp samples it) so the two
 * never share a plane. 0 without a build-up.
 */
export function ceilingCapLift(
  ceiling: Pick<CeilingNode, 'buildUp' | 'height' | 'parentId' | 'polygon'>,
  nodes: Record<AnyNodeId, AnyNode>,
): number {
  const thickness = ceiling.buildUp ? ceilingBuildUpThickness(ceiling.buildUp) : 0
  if (!(thickness > 0) || typeof ceiling.parentId !== 'string') return Math.max(0, thickness)
  const underside = resolveCeilingHeight(ceiling, nodes)
  const polygon = ceiling.polygon
  let lift = thickness
  if (polygon.length > 0) {
    const cx = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length
    const cz = polygon.reduce((sum, [, z]) => sum + z, 0) / polygon.length
    for (const [x, z] of [...polygon, [cx, cz] as [number, number]]) {
      const above = getCoveringSlabUndersideAt(ceiling.parentId, nodes, x, z)
      if (above !== null) lift = Math.min(lift, above - CEILING_CLAMP_MARGIN - underside)
    }
  }
  return Math.max(0, lift)
}

export type RoofBuildUpPreset = { id: string; label: string; buildUp: RoofBuildUp }
export type CeilingBuildUpPreset = { id: string; label: string; buildUp: CeilingBuildUp }

const roofPreset = (id: string, label: string, buildUp: Omit<RoofBuildUp, 'presetId'>) => ({
  id,
  label,
  buildUp: { presetId: id, ...buildUp },
})

const ceilingPreset = (id: string, label: string, buildUp: Omit<CeilingBuildUp, 'presetId'>) => ({
  id,
  label,
  buildUp: { presetId: id, ...buildUp },
})

const shingles = {
  kind: 'architectural-shingle',
  thickness: ROOFING_THICKNESS['architectural-shingle'],
} as const
const synthetic = { kind: 'synthetic', thickness: UNDERLAYMENT_THICKNESS.synthetic } as const
const osb = (thickness = inches(7 / 16)) => ({ kind: 'osb', thickness }) as const
const plywood = (thickness: number) => ({ kind: 'plywood', thickness }) as const
const drywall = (thickness = inches(0.5)) => ({ kind: 'drywall', thickness }) as const

/**
 * The first is the default: 2x4 trusses under 7/16 in OSB, a 7-7/16 in deck
 * (the top chord on its heel). A roof plane without layers draws the schema's
 * 0.100 m, one chord and its sheathing. Labels stay short enough
 * for the inspector's Preset select to show uncut; the fields below it name
 * every layer.
 */
export const ROOF_BUILD_UP_PRESETS: readonly RoofBuildUpPreset[] = [
  roofPreset('asphalt-trusses-24', 'Asphalt on trusses @ 24"', {
    roofing: shingles,
    underlayment: synthetic,
    sheathing: osb(),
    structure: { system: 'trusses', size: '2x4', spacing: inches(24) },
  }),
  roofPreset('asphalt-2x10-16', 'Asphalt on 2x10 @ 16"', {
    roofing: shingles,
    underlayment: synthetic,
    sheathing: osb(),
    structure: { system: 'rafters', size: '2x10', spacing: inches(16) },
  }),
  roofPreset('metal-trusses-24', 'Metal on trusses @ 24"', {
    roofing: { kind: 'standing-seam-metal', thickness: ROOFING_THICKNESS['standing-seam-metal'] },
    underlayment: synthetic,
    sheathing: osb(),
    structure: { system: 'trusses', size: '2x4', spacing: inches(24) },
  }),
  roofPreset('tile-2x8-16', 'Tile on 2x8 @ 16"', {
    roofing: { kind: 'concrete-tile', thickness: ROOFING_THICKNESS['concrete-tile'] },
    underlayment: { kind: 'felt-30', thickness: UNDERLAYMENT_THICKNESS['felt-30'] },
    sheathing: plywood(inches(15 / 32)),
    structure: { system: 'rafters', size: '2x8', spacing: inches(16) },
  }),
  roofPreset('cathedral-2x12-16', 'Cathedral 2x12 @ 16"', {
    roofing: shingles,
    underlayment: { kind: 'ice-and-water', thickness: UNDERLAYMENT_THICKNESS['ice-and-water'] },
    sheathing: plywood(inches(19 / 32)),
    structure: { system: 'rafters', size: '2x12', spacing: inches(16) },
    insulation: { kind: 'batt', thickness: LUMBER_DEPTH['2x12'] },
    finish: drywall(),
  }),
]

export const CEILING_BUILD_UP_PRESETS: readonly CeilingBuildUpPreset[] = [
  ceilingPreset('drywall-2x6-16', 'Drywall on 2x6 @ 16"', {
    finish: drywall(),
    framing: { system: 'joists', size: '2x6', spacing: inches(16) },
  }),
  ceilingPreset('trusses-24-blown', 'Truss chords @ 24", blown', {
    finish: drywall(inches(0.625)),
    framing: { system: 'truss-chords', size: '2x4', spacing: inches(24) },
    insulation: { kind: 'blown', thickness: inches(12) },
  }),
  ceilingPreset('storage-2x8-16', 'Attic storage 2x8 @ 16"', {
    finish: drywall(),
    framing: { system: 'joists', size: '2x8', spacing: inches(16) },
    insulation: { kind: 'batt', thickness: LUMBER_DEPTH['2x8'] },
    decking: plywood(inches(3 / 4)),
  }),
]

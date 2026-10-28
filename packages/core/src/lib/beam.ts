import type { AnyNode, AnyNodeId, LevelNode, SlabNode } from '../schema'
import {
  BEAM_SIZE_PRESETS,
  type BeamMaterial,
  BeamNode,
  type BeamPlacement,
  type BeamSizePreset,
  type BeamSizePresetId,
  DEFAULT_BEAM_SIZE_PRESET_ID,
} from '../schema/nodes/beam'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { getWallPlaneTop } from '../services/storey'
import { pointInPolygon, pointOnPolygonBoundary } from '../systems/slab/slab-support'
import { isSiteFlatwork } from './site-flatwork'

type Nodes = Record<AnyNodeId, AnyNode>
type P = [number, number]

const INCH = 0.0254
/** Two sections within this of each other are one size (a 32nd of an inch). */
const SIZE_TOLERANCE = INCH / 32

/**
 * The stock size with this id or label (`BEAM_SIZE_PRESETS`): '(2)2x10' and '(2) 2x10' are both
 * the two-ply 2x10.
 */
export function beamSizePreset(idOrLabel: string): BeamSizePreset | undefined {
  return BEAM_SIZE_PRESETS.find((preset) => preset.id === idOrLabel || preset.label === idOrLabel)
}

/** Whether a beam of `material` can be a preset of `presetMaterial`: sawn stock comes treated too. */
function materialFits(material: BeamMaterial, presetMaterial: BeamMaterial): boolean {
  if (presetMaterial === 'sawn') return material === 'sawn' || material === 'pressure-treated'
  return material === presetMaterial
}

/**
 * The stock size a beam is, if it is one: as many plies of the same nominal size (when it names
 * one), the same section, and a material that size comes in.
 */
export function matchBeamSizePreset(
  beam: Pick<BeamNode, 'width' | 'depth' | 'plies' | 'material'> & { size?: string },
): BeamSizePreset | null {
  for (const preset of BEAM_SIZE_PRESETS) {
    if (preset.plies !== beam.plies) continue
    if (beam.size !== undefined && beam.size !== preset.size) continue
    if (!materialFits(beam.material, preset.material)) continue
    if (Math.abs(preset.width - beam.width) > SIZE_TOLERANCE) continue
    if (Math.abs(preset.depth - beam.depth) > SIZE_TOLERANCE) continue
    return preset
  }
  return null
}

/**
 * A length in inches and sixteenths, as a framing size prints it: 3.5 in reads "3-1/2", 0.75 in
 * "3/4", 9 in "9".
 */
export function inchFractionLabel(metres: number, denominator = 16): string {
  const total = Math.round((Math.abs(metres) / INCH) * denominator)
  const whole = Math.floor(total / denominator)
  let numerator = total % denominator
  let over = denominator
  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2
    over /= 2
  }
  if (numerator === 0) return `${whole}`
  return whole > 0 ? `${whole}-${numerator}/${over}` : `${numerator}/${over}`
}

/** What a plan adds after the size to say what a beam is made of; a W shape is steel by its name. */
const MATERIAL_SUFFIX: Record<BeamMaterial, string> = {
  sawn: '',
  'pressure-treated': ' PT',
  lvl: ' LVL',
  glulam: ' GLB',
  steel: '',
}

/** What each material is called in a list or a panel. */
export const BEAM_MATERIAL_LABELS: Record<BeamMaterial, string> = {
  sawn: 'Sawn lumber',
  'pressure-treated': 'Pressure-treated',
  lvl: 'LVL',
  glulam: 'Glulam',
  steel: 'Steel',
}

/**
 * How each material looks, from the material library: fir for sawn lumber, a weathered grey-brown
 * for treated, the pale veneer of an LVL, the warm laminations of a glulam, steel.
 */
export const BEAM_MATERIAL_LIBRARY_REFS: Record<BeamMaterial, string> = {
  sawn: 'library:wood-woodfine2',
  'pressure-treated': 'library:wood-woodplank19',
  lvl: 'library:wood-woodfine22',
  glulam: 'library:wood-woodfine13',
  steel: 'library:metal-steel',
}

/**
 * A beam's size as a framing plan prints it: "6x8", "(2) 2x10", "6x8 PT", "1-3/4x11-7/8 LVL",
 * "W8x10"; a section that is no stock size by its actual inches ("3-1/2x9-1/4").
 */
export function beamSizeLabel(
  beam: Pick<BeamNode, 'width' | 'depth' | 'plies' | 'material'> & { size?: string },
): string {
  const suffix = MATERIAL_SUFFIX[beam.material]
  const size = beam.size ?? matchBeamSizePreset(beam)?.size
  if (size) return `${beam.plies > 1 ? `(${beam.plies}) ` : ''}${size}${suffix}`
  return `${inchFractionLabel(beam.width)}x${inchFractionLabel(beam.depth)}${suffix}`
}

/**
 * The fields that make a beam a stock size. Sawn sizes keep a treated beam treated; any other
 * size brings its own material.
 */
export function beamSizePresetPatch(
  beam: Pick<BeamNode, 'material'>,
  presetId: string,
): Partial<BeamNode> {
  const preset = beamSizePreset(presetId)
  if (!preset) return {}
  return {
    size: preset.size,
    plies: preset.plies,
    width: preset.width,
    depth: preset.depth,
    material: materialFits(beam.material, preset.material) ? beam.material : preset.material,
  }
}

/** What `createBeam` builds a beam from. */
export type BeamInput = {
  /** The centreline, level-local plan points `[x, z]`. */
  start: readonly [number, number]
  end: readonly [number, number]
  /**
   * A stock size by id or label (`BEAM_SIZE_PRESETS`), a 6x8 by default (an unknown one too).
   * Ignored when `width` and `depth` are given.
   */
  preset?: BeamSizePresetId | (string & {})
  /** A custom section, metres (every ply together across), in place of a stock size. */
  width?: number
  depth?: number
  /** How many plies a custom section is nailed up from (a stock size brings its own). */
  plies?: number
  /** What it is made of; else what the stock size is (sawn lumber for a custom section). */
  material?: BeamMaterial
  placement?: BeamPlacement
  /** Its top, level-local metres; absent = the level's ceiling plane over it. */
  topElevation?: number
  /** The level it goes on: its `parentId`. */
  levelId?: string
  /** The slab it belongs to, if any (a porch's or a deck's). */
  supportSlabId?: string
  name?: string
  metadata?: Record<string, unknown>
}

/**
 * A beam node from a centreline and a size, ready for `createNode` on its level: what the beam
 * tool draws, and what code that frames a porch or a deck makes.
 */
export function createBeam(input: BeamInput): BeamNode {
  const custom = input.width !== undefined && input.depth !== undefined
  const preset = custom
    ? undefined
    : (beamSizePreset(input.preset ?? DEFAULT_BEAM_SIZE_PRESET_ID) ??
      beamSizePreset(DEFAULT_BEAM_SIZE_PRESET_ID))
  return BeamNode.parse({
    start: [input.start[0], input.start[1]],
    end: [input.end[0], input.end[1]],
    width: custom ? input.width : preset?.width,
    depth: custom ? input.depth : preset?.depth,
    size: preset?.size,
    plies: custom ? (input.plies ?? 1) : preset?.plies,
    material: input.material ?? preset?.material ?? 'sawn',
    placement: input.placement ?? 'dropped',
    ...(input.topElevation !== undefined ? { topElevation: input.topElevation } : {}),
    ...(input.levelId ? { parentId: input.levelId } : {}),
    ...(input.supportSlabId ? { supportSlabId: input.supportSlabId } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })
}

/** A beam's plan, level-local: its centreline, run, the way it runs and across it. */
export type BeamPlan = {
  start: P
  end: P
  length: number
  /** Unit vector start → end. */
  direction: P
  /** Unit vector to the left of the run (the wall convention's +normal). */
  normal: P
  width: number
}

export function beamPlan(beam: Pick<BeamNode, 'start' | 'end' | 'width'>): BeamPlan {
  const dx = beam.end[0] - beam.start[0]
  const dz = beam.end[1] - beam.start[1]
  const length = Math.hypot(dx, dz)
  const direction: P = length > 1e-9 ? [dx / length, dz / length] : [1, 0]
  return {
    start: [beam.start[0], beam.start[1]],
    end: [beam.end[0], beam.end[1]],
    length,
    direction,
    normal: [-direction[1], direction[0]],
    width: beam.width,
  }
}

/** The beam's outline in plan, level-local: four corners, start's left first. */
export function beamOutline(beam: Pick<BeamNode, 'start' | 'end' | 'width'>): P[] {
  const { start, end, normal, width } = beamPlan(beam)
  const [nx, nz] = [normal[0] * (width / 2), normal[1] * (width / 2)]
  return [
    [start[0] + nx, start[1] + nz],
    [end[0] + nx, end[1] + nz],
    [end[0] - nx, end[1] - nz],
    [start[0] - nx, start[1] - nz],
  ]
}

/**
 * The ceiling plane over a beam, level-local: the top of the level's walls there, the storey's
 * height or the underside of a slab of the level above that covers the beam (`getWallPlaneTop`
 * over the beam's width, as for a wall).
 */
export function beamCeilingPlane(
  nodes: Nodes,
  beam: Pick<BeamNode, 'start' | 'end' | 'width' | 'parentId'>,
): number {
  if (!beam.parentId) return DEFAULT_LEVEL_HEIGHT
  return getWallPlaneTop(
    { start: beam.start, end: beam.end, thickness: beam.width },
    beam.parentId,
    nodes,
  )
}

/**
 * Where a beam's top is, level-local. A stored `topElevation` stands; without one the beam
 * follows the ceiling plane over it: a dropped beam hangs under it, the joists bearing on its
 * top, and a flush one sits in the ceiling framing with its underside on it.
 */
export function beamTopElevation(
  nodes: Nodes,
  beam: Pick<
    BeamNode,
    'start' | 'end' | 'width' | 'depth' | 'parentId' | 'placement' | 'topElevation'
  >,
): number {
  if (beam.topElevation !== undefined) return beam.topElevation
  const plane = beamCeilingPlane(nodes, beam)
  return beam.placement === 'flush' ? plane + beam.depth : plane
}

/** Where a beam's underside is, level-local: what a post under it stands up to. */
export function beamBottomElevation(
  nodes: Nodes,
  beam: Pick<
    BeamNode,
    'start' | 'end' | 'width' | 'depth' | 'parentId' | 'placement' | 'topElevation'
  >,
): number {
  return beamTopElevation(nodes, beam) - beam.depth
}

/** The floor at a plan point of a level, level-local: the highest floor slab there, its top and underside. */
export type LevelFloorAt = { top: number; underside: number; slabId: string | null }

function slabHolds(slab: SlabNode, [x, z]: P): boolean {
  if (!(pointInPolygon(x, z, slab.polygon) || pointOnPolygonBoundary(x, z, slab.polygon)))
    return false
  for (const hole of slab.holes ?? []) {
    if (hole.length >= 3 && pointInPolygon(x, z, hole)) return false
  }
  return true
}

/**
 * The floor a level stands on at a plan point: the highest of its floor slabs there (not a pit,
 * not the site's paving), its top and the underside of its body; the level's own plane, 0, where
 * none is.
 */
export function levelFloorAt(
  nodes: Nodes,
  levelId: string,
  point: readonly [number, number],
): LevelFloorAt {
  const level = nodes[levelId as LevelNode['id']]
  let floor: LevelFloorAt = { top: 0, underside: 0, slabId: null }
  if (level?.type !== 'level') return floor
  let best: SlabNode | null = null
  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type !== 'slab' || child.visible === false) continue
    if (child.recessed === true || isSiteFlatwork(child) || child.polygon.length < 3) continue
    if (!slabHolds(child, [point[0], point[1]])) continue
    if (!best || child.elevation > best.elevation) best = child
  }
  if (best)
    floor = { top: best.elevation, underside: best.elevation - best.thickness, slabId: best.id }
  return floor
}

/**
 * Where a beam's top is set from, as the panel lists them: under the ceiling plane (a dropped
 * beam, the default) or flush in the ceiling framing, both following the plane; flush with the
 * floor (its top the floor's) or under the floor's framing (a girder in a crawl space, a deck's
 * beam under its joists), both measured at the beam's middle.
 */
export type BeamTopReference = 'ceiling-dropped' | 'ceiling-flush' | 'floor-flush' | 'floor-under'

export const BEAM_TOP_REFERENCES: readonly BeamTopReference[] = [
  'ceiling-dropped',
  'ceiling-flush',
  'floor-flush',
  'floor-under',
]

export const BEAM_TOP_REFERENCE_LABELS: Record<BeamTopReference, string> = {
  'ceiling-dropped': 'Under ceiling plane',
  'ceiling-flush': 'Flush in ceiling',
  'floor-flush': 'Flush with floor',
  'floor-under': 'Under floor',
}

function beamFloor(nodes: Nodes, beam: Pick<BeamNode, 'start' | 'end' | 'parentId'>): LevelFloorAt {
  if (!beam.parentId) return { top: 0, underside: 0, slabId: null }
  const middle: P = [(beam.start[0] + beam.end[0]) / 2, (beam.start[1] + beam.end[1]) / 2]
  return levelFloorAt(nodes, beam.parentId, middle)
}

/** The fields that put a beam's top at `reference`. */
export function beamTopReferencePatch(
  nodes: Nodes,
  beam: Pick<BeamNode, 'start' | 'end' | 'parentId'>,
  reference: BeamTopReference,
): Pick<BeamNode, 'topElevation' | 'placement'> {
  if (reference === 'ceiling-dropped') return { topElevation: undefined, placement: 'dropped' }
  if (reference === 'ceiling-flush') return { topElevation: undefined, placement: 'flush' }
  const floor = beamFloor(nodes, beam)
  return reference === 'floor-flush'
    ? { topElevation: floor.top, placement: 'flush' }
    : { topElevation: floor.underside, placement: 'dropped' }
}

/** Which of the references a beam's top is set from now, or null for a top typed in by hand. */
export function beamTopReferenceOf(
  nodes: Nodes,
  beam: Pick<BeamNode, 'start' | 'end' | 'parentId' | 'placement' | 'topElevation'>,
): BeamTopReference | null {
  if (beam.topElevation === undefined)
    return beam.placement === 'flush' ? 'ceiling-flush' : 'ceiling-dropped'
  const floor = beamFloor(nodes, beam)
  if (beam.placement === 'flush' && Math.abs(beam.topElevation - floor.top) < 1e-6)
    return 'floor-flush'
  if (beam.placement === 'dropped' && Math.abs(beam.topElevation - floor.underside) < 1e-6)
    return 'floor-under'
  return null
}

/**
 * The beams of a level over a plan point, the lowest underside first: those whose outline,
 * grown by `margin` all round, holds the point. What a post set there stands up to.
 */
export function beamsOverPoint(
  nodes: Nodes,
  levelId: string,
  point: readonly [number, number],
  margin = 0.01,
): BeamNode[] {
  const found: { beam: BeamNode; bottom: number }[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'beam' || node.parentId !== levelId || node.visible === false) continue
    const { start, length, direction, normal, width } = beamPlan(node)
    const rx = point[0] - start[0]
    const rz = point[1] - start[1]
    const along = rx * direction[0] + rz * direction[1]
    const across = rx * normal[0] + rz * normal[1]
    if (along < -margin || along > length + margin) continue
    if (Math.abs(across) > width / 2 + margin) continue
    found.push({ beam: node, bottom: beamBottomElevation(nodes, node) })
  }
  return found.sort((a, b) => a.bottom - b.bottom).map(({ beam }) => beam)
}

/**
 * Where posts stand under a beam run: at both ends and evenly between, no two further apart than
 * `maxSpacing`. A porch's open edge gets its posts this way.
 */
export function postStationsAlong(
  start: readonly [number, number],
  end: readonly [number, number],
  maxSpacing: number,
): P[] {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const spans = maxSpacing > 0 ? Math.max(1, Math.ceil(length / maxSpacing - 1e-9)) : 1
  return Array.from({ length: spans + 1 }, (_, index) => {
    const t = index / spans
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t] as P
  })
}

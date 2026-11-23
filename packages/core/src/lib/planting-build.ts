import { PlantingNode, type PlantingSpecies } from '../schema/nodes/planting'
import type { GroundRead } from './ground-read'
import {
  PLANTING_CHUNK_PLANTS,
  PLANTING_MAX_TRIANGLES,
  type PlantingEstimate,
  type PlantingFormInput,
} from './planting-form'
import { plantingGroundGeometry } from './planting-ground'
import {
  type PlantingPoint,
  plantingArea,
  plantingAreaOutline,
  plantingOrganicOutline,
} from './planting-outline'
import { type PlantingAccept, type PlantingPlacement, scatterPlanting } from './planting-scatter'

const SIDES = 12
const RINGS = 6
const STEMS = 18
const BLADES = 28
const SEGMENTS = 4

export type BodyCount = Readonly<{ vertices: number; triangles: number }>
const SHELL_COUNT: BodyCount = Object.freeze({
  vertices: RINGS * SIDES + 1,
  triangles: (RINGS - 1) * SIDES * 2 + SIDES,
})
const SPIKE_COUNT: BodyCount = Object.freeze({
  vertices: SHELL_COUNT.vertices + STEMS * 4,
  triangles: SHELL_COUNT.triangles + STEMS * 2,
})
const TUFT_COUNT: BodyCount = Object.freeze({
  vertices: BLADES * (SEGMENTS + 1) * 2,
  triangles: BLADES * SEGMENTS * 2,
})

/** Shared immutable counts: estimation creates no per-plant records or geometry arrays. */
export function plantingBodyCount(plant: PlantingSpecies): BodyCount {
  return plant.habit === 'tuft' ? TUFT_COUNT : plant.habit === 'spike' ? SPIKE_COUNT : SHELL_COUNT
}

/** Desired leaf/flower cards before the node budget thins detail, never whole plants or layers. */
export function plantingDetailCount(plant: PlantingSpecies, placement: PlantingPlacement) {
  const size = plant.spread * placement.scale
  const height = plant.height * placement.scale * (plant.habit === 'spike' ? 0.4 : 1)
  const density =
    plant.habit === 'carpet' ? 2000 : plant.habit === 'mound' && plant.layer === 'mid' ? 1100 : 910
  const leaves =
    plant.habit === 'tuft'
      ? 0
      : Math.min(2100, Math.max(168, Math.round((size * size + size * height) * density)))
  const flowers = plant.flowerColor
    ? plant.habit === 'spike'
      ? STEMS * 4
      : Math.min(96, Math.max(12, Math.round(size * size * 120)))
    : 0
  return leaves + flowers
}

type PlannedCounts = Pick<PlantingFormInput, 'placements' | 'groundTriangles'>

export function plantingBudgetOf(node: PlantingNode, plan: PlannedCounts) {
  let bodyTriangles = plan.groundTriangles
  let bodyVertices = plan.groundTriangles * 3
  let wanted = 0
  for (const placement of plan.placements) {
    const species = node.plants[placement.species] as PlantingSpecies
    const body = plantingBodyCount(species)
    bodyTriangles += body.triangles
    bodyVertices += body.vertices
    wanted += plantingDetailCount(species, placement)
  }
  const available = Math.max(0, Math.floor((PLANTING_MAX_TRIANGLES - bodyTriangles) / 2))
  return { bodyTriangles, bodyVertices, share: wanted > available ? available / wanted : 1 }
}

/** Numeric estimate over a plan: constant auxiliary storage, no geometry-sized allocations. */
export function estimatePlanting(node: PlantingNode, plan: PlannedCounts): PlantingEstimate {
  const { bodyTriangles, bodyVertices, share } = plantingBudgetOf(node, plan)
  let leaves = 0
  for (const placement of plan.placements)
    leaves += Math.floor(
      plantingDetailCount(node.plants[placement.species] as PlantingSpecies, placement) * share,
    )
  return {
    triangles: bodyTriangles + 2 * leaves,
    vertices: bodyVertices + 4 * leaves,
    bodyTriangles,
    leaves,
    meshes:
      Math.ceil(plan.placements.length / PLANTING_CHUNK_PLANTS) +
      (plan.groundTriangles > 0 ? 1 : 0),
  }
}

export type PlantingPlan = {
  outline: PlantingPoint[]
  placements: PlantingPlacement[]
  area: number
  /** Nominal projected crown area / bed area, capped at one; not a union of overlapping leaves. */
  cover: number
  groundTriangles: number
  estimate: PlantingEstimate
  withinBudget: boolean
  gen: 1
  input: PlantingFormInput
}

/** Validate before computation; plan bounded outline/placements, never mesh attribute buffers. */
export function planPlanting(
  node: PlantingNode,
  ground: GroundRead,
  accept?: PlantingAccept,
): PlantingPlan {
  const parsed = PlantingNode.parse(node)
  const outline = plantingOrganicOutline(
    parsed.outline ?? plantingAreaOutline(parsed.area as number, parsed.center),
    parsed.seed,
  )
  const area = Math.abs(plantingArea(outline))
  const placements = scatterPlanting(parsed, outline, ground, accept)
  const groundTriangles = plantingGroundGeometry(parsed, outline, ground)
  const input: PlantingFormInput = { node: parsed, outline, placements, ground, groundTriangles }
  const estimate = estimatePlanting(parsed, input)
  let crownArea = 0
  for (const placement of placements) {
    const spread = parsed.plants[placement.species]?.spread ?? 0
    crownArea += Math.PI * ((spread * placement.scale) / 2) ** 2
  }
  return {
    outline,
    placements,
    area,
    cover: Math.min(1, crownArea / area),
    groundTriangles,
    input,
    estimate,
    withinBudget: estimate.triangles <= PLANTING_MAX_TRIANGLES,
    gen: 1,
  }
}

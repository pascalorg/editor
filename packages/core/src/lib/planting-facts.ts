import type { AnyNode, PlantingNode, PlantingSpecies } from '../schema'
import { type PlantingPlan, planPlanting } from './planting-build'
import { resolvePlantingAccept, resolvePlantingGround } from './planting-scene'

export type PlantingFacts = {
  areaM2: number
  plants: number
  byHabit: Record<PlantingSpecies['habit'], number>
  byLayer: Record<PlantingSpecies['layer'], number>
  /** Projected crown area divided by bed area, capped at one; not measured canopy union. */
  cover: number
  triangles: number
  bodyTriangles: number
  leaves: number
  meshes: number
  gen: number
}

/** Facts from the retained scatter, after scene clearance and budget thinning, never requested shares. */
export function plantingFacts(
  node: PlantingNode,
  nodes: Readonly<Record<string, AnyNode>>,
  planned?: PlantingPlan,
): PlantingFacts {
  let plan = planned
  if (!plan) {
    const ground = resolvePlantingGround(node, nodes)
    plan = planPlanting(node, ground, resolvePlantingAccept(node, nodes, ground))
  }
  const byHabit: PlantingFacts['byHabit'] = { mound: 0, ball: 0, spike: 0, tuft: 0, carpet: 0 }
  const byLayer: PlantingFacts['byLayer'] = { back: 0, mid: 0, edge: 0 }
  for (const placement of plan.placements) {
    const plant = node.plants[placement.species]
    if (plant) byHabit[plant.habit]++
    byLayer[placement.layer]++
  }
  return {
    areaM2: plan.area,
    plants: plan.placements.length,
    byHabit,
    byLayer,
    cover: plan.cover,
    triangles: plan.estimate.triangles,
    bodyTriangles: plan.estimate.bodyTriangles,
    leaves: plan.estimate.leaves,
    meshes: plan.estimate.meshes,
    gen: plan.gen,
  }
}

import type { PlantingNode, PlantingSpecies } from '../schema/nodes/planting'
import type { MeshWriter } from './foliage'
import {
  plantingBodyCount,
  plantingDetailCount,
  writePlantingBody,
  writePlantingDetail,
} from './planting-bodies'
import {
  PLANTING_CHUNK_PLANTS,
  PLANTING_MAX_TRIANGLES,
  type PlantingEstimate,
  type PlantingForm,
  type PlantingFormInput,
  type PlantingMesh,
} from './planting-form'
import { plantingGroundGeometry } from './planting-ground'
import type { PlantingPlacement } from './planting-scatter'

type PlannedCounts = Pick<PlantingFormInput, 'placements' | 'groundTriangles'>

function budgetOf(node: PlantingNode, plan: PlannedCounts) {
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
  const { bodyTriangles, bodyVertices, share } = budgetOf(node, plan)
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

function writer(vertices: number, triangles: number): MeshWriter {
  return {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    color: new Float32Array(vertices * 3),
    index: vertices > 65535 ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3),
    vertices: 0,
    indices: 0,
  }
}

function finish(out: MeshWriter, bodyIndexCount: number): PlantingMesh {
  return {
    position: out.position,
    normal: out.normal,
    color: out.color,
    index: out.index,
    bodyIndexCount,
  }
}

function build(input: PlantingFormInput): PlantingMesh[] {
  const { node, placements, groundTriangles } = input
  const estimate = estimatePlanting(node, input)
  if (estimate.triangles > PLANTING_MAX_TRIANGLES) return []
  const { share } = budgetOf(node, input)
  const meshes: PlantingMesh[] = []
  if (groundTriangles) {
    const out = writer(groundTriangles * 3, groundTriangles)
    plantingGroundGeometry(node, input.outline, input.ground, out)
    meshes.push(finish(out, out.indices))
  }
  for (let first = 0; first < placements.length; first += PLANTING_CHUNK_PLANTS) {
    const end = Math.min(placements.length, first + PLANTING_CHUNK_PLANTS)
    let vertices = 0
    let triangles = 0
    for (let i = first; i < end; i++) {
      const placement = placements[i] as PlantingPlacement
      const species = node.plants[placement.species] as PlantingSpecies
      const body = plantingBodyCount(species)
      const leaves = Math.floor(plantingDetailCount(species, placement) * share)
      vertices += body.vertices + 4 * leaves
      triangles += body.triangles + 2 * leaves
    }
    const out = writer(vertices, triangles)
    for (let i = first; i < end; i++) {
      const placement = placements[i] as PlantingPlacement
      writePlantingBody(out, node.plants[placement.species] as PlantingSpecies, placement)
    }
    const bodyIndexCount = out.indices
    for (let i = first; i < end; i++) {
      const placement = placements[i] as PlantingPlacement
      const species = node.plants[placement.species] as PlantingSpecies
      writePlantingDetail(
        out,
        species,
        placement,
        Math.floor(plantingDetailCount(species, placement) * share),
      )
    }
    meshes.push(finish(out, bodyIndexCount))
  }
  return meshes
}

export const plantingFormV1: PlantingForm = {
  gen: 1,
  estimate: (input) => estimatePlanting(input.node, input),
  build,
}

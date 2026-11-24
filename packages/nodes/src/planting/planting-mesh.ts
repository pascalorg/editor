import {
  type GroundRead,
  PLANTING_CHUNK_PLANTS,
  PLANTING_MAX_TRIANGLES,
  type PlantingAccept,
  type PlantingMesh,
  type PlantingNode,
  type PlantingPlacement,
  type PlantingPlan,
  type PlantingSpecies,
  planPlanting,
  plantingBodyCount,
  plantingBudgetOf,
  plantingDetailCount,
  plantingGroundGeometry,
  type Rgb,
} from '@pascal-app/core'
import { type MeshWriter, writeTriangle, writeVertex } from '../shared/foliage'
import { writePlantingBody, writePlantingDetail } from './planting-bodies'

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

function writeGroundTriangle(out: MeshWriter, a: Rgb, b: Rgb, c: Rgb, color: Rgb) {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz) || 1
  const first = out.vertices
  for (const p of [a, b, c]) writeVertex(out, ...p, nx / length, ny / length, nz / length, ...color)
  writeTriangle(out, first, first + 1, first + 2)
}

/** New arrays owned by the caller, with body-only far levels in each mesh's index prefix. */
export function buildPlanting(
  node: PlantingNode,
  ground: GroundRead,
  accept?: PlantingAccept,
): { plan: PlantingPlan; meshes: PlantingMesh[] } {
  const plan = planPlanting(node, ground, accept)
  if (!plan.withinBudget || plan.estimate.triangles > PLANTING_MAX_TRIANGLES) {
    return { plan, meshes: [] }
  }
  const { node: parsed, outline, placements, groundTriangles } = plan.input
  const { share } = plantingBudgetOf(parsed, plan.input)
  const meshes: PlantingMesh[] = []
  if (groundTriangles) {
    const out = writer(groundTriangles * 3, groundTriangles)
    plantingGroundGeometry(parsed, outline, plan.input.ground, (a, b, c, color) =>
      writeGroundTriangle(out, a, b, c, color),
    )
    meshes.push(finish(out, out.indices))
  }
  for (let first = 0; first < placements.length; first += PLANTING_CHUNK_PLANTS) {
    const end = Math.min(placements.length, first + PLANTING_CHUNK_PLANTS)
    let vertices = 0
    let triangles = 0
    for (let i = first; i < end; i++) {
      const placement = placements[i] as PlantingPlacement
      const species = parsed.plants[placement.species] as PlantingSpecies
      const body = plantingBodyCount(species)
      const leaves = Math.floor(plantingDetailCount(species, placement) * share)
      vertices += body.vertices + 4 * leaves
      triangles += body.triangles + 2 * leaves
    }
    const out = writer(vertices, triangles)
    for (let i = first; i < end; i++) {
      const placement = placements[i] as PlantingPlacement
      writePlantingBody(out, parsed.plants[placement.species] as PlantingSpecies, placement)
    }
    const bodyIndexCount = out.indices
    for (let i = first; i < end; i++) {
      const placement = placements[i] as PlantingPlacement
      const species = parsed.plants[placement.species] as PlantingSpecies
      writePlantingDetail(
        out,
        species,
        placement,
        Math.floor(plantingDetailCount(species, placement) * share),
      )
    }
    meshes.push(finish(out, bodyIndexCount))
  }
  return { plan, meshes }
}

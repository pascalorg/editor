import type { PlantingNode } from '../schema/nodes/planting'
import type { GroundRead } from './ground-read'
import type { PlantingPoint } from './planting-outline'
import type { PlantingPlacement } from './planting-scatter'

export const PLANTING_MAX_TRIANGLES = 120_000
export const PLANTING_CHUNK_PLANTS = 64

/** Site metres, Y up, linear RGB. Bodies precede detail so the index prefix is a far level. */
export type PlantingMesh = {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint16Array | Uint32Array
  bodyIndexCount: number
}

export type PlantingEstimate = {
  triangles: number
  vertices: number
  bodyTriangles: number
  /** Two-triangle detail cards, including flower dots. */
  leaves: number
  meshes: number
}

export type PlantingFormInput = {
  node: PlantingNode
  outline: readonly PlantingPoint[]
  placements: readonly PlantingPlacement[]
  ground: GroundRead
  groundTriangles: number
}

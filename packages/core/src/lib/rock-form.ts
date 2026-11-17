import type { RockNode } from '../schema'
import type { RockSpan } from './rock-ground'

export type RockPoint = [number, number]
export type RockShapeInput = Pick<RockNode, 'polygon' | 'seed' | 'form'> &
  Partial<Pick<RockNode, 'gen' | 'rockType' | 'weathering'>>
export type RockFormInput = RockShapeInput & RockSpan
export type RockLevel = 'near' | 'far'

/** Indexed CCW triangles in the Site frame, metres, Y up. No renderer dependency. */
export type RockMesh = { position: Float32Array; index: Uint16Array }
export type RockLevelEstimate = { triangles: number; vertices: number }
export type RockEstimate = {
  near: RockLevelEstimate
  far: RockLevelEstimate
  /** Total resident geometry, not just the currently visible level. */
  triangles: number
  vertices: number
  meshes: number
}
export type RockForm = {
  gen: 1 | 2
  /** Topology/counts only: never samples the field or allocates mesh buffers. */
  estimate: (input: RockFormInput) => RockEstimate
  build: (input: RockFormInput, level: RockLevel) => RockMesh | null
}

export const ROCK_MAX_NEAR_TRIANGLES = 4096
export const ROCK_MAX_FAR_TRIANGLES = 600
export const ROCK_MAX_TRIANGLES = ROCK_MAX_NEAR_TRIANGLES + ROCK_MAX_FAR_TRIANGLES

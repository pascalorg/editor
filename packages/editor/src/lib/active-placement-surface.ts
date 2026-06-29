import { Vector3 } from 'three'

// The surface the active placement/move ghost is currently snapped to: a contact
// point (world space) and the surface's outward unit normal. Published each frame
// by the placement tools (the item coordinator + the drawn-kind tools) and read
// by the grid so its snap patch sits at the ghost's height AND orients to the
// surface — horizontal on a floor / shelf top, vertical in a wall plane.
//
// A plain module singleton (not a store): both writer and reader run inside
// `useFrame`, so reactivity would only add overhead. The vectors are reused, so
// readers must consume them within the same frame.
export type PlacementSurface = {
  point: Vector3
  normal: Vector3
}

const surface: PlacementSurface = {
  point: new Vector3(),
  normal: new Vector3(0, 1, 0),
}
let active = false

export function publishPlacementSurface(point: Vector3, normal: Vector3): void {
  surface.point.copy(point)
  surface.normal.copy(normal)
  active = true
}

export function clearPlacementSurface(): void {
  active = false
}

export function getPlacementSurface(): PlacementSurface | null {
  return active ? surface : null
}

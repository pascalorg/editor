import {
  FLAT_GROUND_Y,
  heightAt,
  raycastTerrain,
  type SiteNode,
  type TerrainField,
  terrainFieldOf,
} from '@pascal-app/core'
import { type Camera, type Ray, Raycaster, Vector2 } from 'three'

type PointerPosition = Pick<PointerEvent, 'clientX' | 'clientY'>
type CanvasBounds = {
  getBoundingClientRect: () => Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
}
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }
type GroundPlane = Bounds & { x: number; z: number; height: number; slopeX: number; slopeZ: number }

function regionInterval(ray: Ray, bounds: Bounds): [number, number] | null {
  let near = 0,
    far = Infinity
  const slabs: [number, number, number, number][] = [
    [ray.origin.x, ray.direction.x, bounds.minX, bounds.maxX],
    [ray.origin.z, ray.direction.z, bounds.minZ, bounds.maxZ],
  ]
  for (const [origin, direction, min, max] of slabs) {
    if (Math.abs(direction) < 1e-12) {
      if (origin < min || origin > max) return null
      continue
    }
    const first = (min - origin) / direction,
      last = (max - origin) / direction
    near = Math.max(near, Math.min(first, last))
    far = Math.min(far, Math.max(first, last))
    if (near > far) return null
  }
  return [near, far]
}

function planeHit(ray: Ray, plane: GroundPlane): number | null {
  const interval = regionInterval(ray, plane)
  if (!interval) return null
  const gap =
    plane.height +
    plane.slopeX * (ray.origin.x - plane.x) +
    plane.slopeZ * (ray.origin.z - plane.z) -
    ray.origin.y
  const denominator =
    ray.direction.y - plane.slopeX * ray.direction.x - plane.slopeZ * ray.direction.z
  if (Math.abs(denominator) < 1e-12) return Math.abs(gap) < 1e-9 ? interval[0] : null
  const distance = gap / denominator
  return distance >= interval[0] && distance <= interval[1] ? distance : null
}

function* verticalEdgePlanes(field: TerrainField, bounds: Bounds): Generator<GroundPlane> {
  for (let row = 0; row + 1 < field.rows; row++) {
    const z = bounds.minZ + row * field.spacing
    for (const side of [
      { x: bounds.minX, minX: -Infinity, maxX: bounds.minX },
      { x: bounds.maxX, minX: bounds.maxX, maxX: Infinity },
    ]) {
      const height = heightAt(field, side.x, z)
      yield {
        ...side,
        minZ: z,
        maxZ: z + field.spacing,
        z,
        height,
        slopeX: 0,
        slopeZ: (heightAt(field, side.x, z + field.spacing) - height) / field.spacing,
      }
    }
  }
}

function* horizontalEdgePlanes(field: TerrainField, bounds: Bounds): Generator<GroundPlane> {
  for (let col = 0; col + 1 < field.cols; col++) {
    const x = bounds.minX + col * field.spacing
    for (const side of [
      { z: bounds.minZ, minZ: -Infinity, maxZ: bounds.minZ },
      { z: bounds.maxZ, minZ: bounds.maxZ, maxZ: Infinity },
    ]) {
      const height = heightAt(field, x, side.z)
      yield {
        ...side,
        minX: x,
        maxX: x + field.spacing,
        x,
        height,
        slopeZ: 0,
        slopeX: (heightAt(field, x + field.spacing, side.z) - height) / field.spacing,
      }
    }
  }
}

function* cornerPlanes(field: TerrainField, bounds: Bounds): Generator<GroundPlane> {
  for (const xSide of [
    { x: bounds.minX, minX: -Infinity, maxX: bounds.minX },
    { x: bounds.maxX, minX: bounds.maxX, maxX: Infinity },
  ])
    for (const zSide of [
      { z: bounds.minZ, minZ: -Infinity, maxZ: bounds.minZ },
      { z: bounds.maxZ, minZ: bounds.maxZ, maxZ: Infinity },
    ]) {
      yield { ...xSide, ...zSide, height: heightAt(field, xSide.x, zSide.z), slopeX: 0, slopeZ: 0 }
    }
}

/** Outside the finite field, heightAt extends each edge cell as a strip and each corner as a plane. */
function clampedTerrainDistance(ray: Ray, field: TerrainField): number | null {
  const bounds = {
    minX: field.origin[0],
    minZ: field.origin[1],
    maxX: field.origin[0] + (field.cols - 1) * field.spacing,
    maxZ: field.origin[1] + (field.rows - 1) * field.spacing,
  }
  const interior = raycastTerrain(
    field,
    [ray.origin.x, ray.origin.y, ray.origin.z],
    [ray.direction.x, ray.direction.y, ray.direction.z],
  )
  let nearest = interior?.t ?? Infinity
  for (const planes of [
    verticalEdgePlanes(field, bounds),
    horizontalEdgePlanes(field, bounds),
    cornerPlanes(field, bounds),
  ]) {
    for (const plane of planes) {
      const distance = planeHit(ray, plane)
      if (distance !== null) nearest = Math.min(nearest, distance)
    }
  }
  return Number.isFinite(nearest) ? nearest : null
}

/** Lawn input owns its Site-ground ray, independently of whether the active-floor grid is hit. */
export function lawnPointerPoint(
  pointer: PointerPosition,
  camera: Camera,
  canvas: CanvasBounds,
  site: SiteNode | null,
): [number, number] | null {
  const rect = canvas.getBoundingClientRect()
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(pointer.clientX) ||
    !Number.isFinite(pointer.clientY)
  )
    return null
  const ndc = new Vector2(
    ((pointer.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((pointer.clientY - rect.top) / rect.height) * 2,
  )
  const raycaster = new Raycaster()
  raycaster.setFromCamera(ndc, camera)
  const ray = raycaster.ray
  const field = terrainFieldOf(site)
  const distance = field
    ? clampedTerrainDistance(ray, field)
    : planeHit(ray, {
        minX: -Infinity,
        maxX: Infinity,
        minZ: -Infinity,
        maxZ: Infinity,
        x: 0,
        z: 0,
        height: FLAT_GROUND_Y,
        slopeX: 0,
        slopeZ: 0,
      })
  return distance === null
    ? null
    : [ray.origin.x + ray.direction.x * distance, ray.origin.z + ray.direction.z * distance]
}

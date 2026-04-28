import type { Object3D } from 'three'
import { Box3, Matrix4, Vector3 } from 'three'

type Point = { x: number; y: number }

export type MeshLocalBounds = {
  min: [number, number, number]
  max: [number, number, number]
}

/** Plan footprint in the item root's horizontal (x, z) plane — stored as floorplan polygon. */
export function computePlanFootprintPolygonLocal(object: Object3D): Point[] {
  object.updateWorldMatrix(true, true)

  const inverseRootMatrix = new Matrix4().copy(object.matrixWorld).invert()
  const localMatrix = new Matrix4()
  const scratchBounds = new Box3()
  const scratchPosition = new Vector3()
  const footprintPoints: Point[] = []

  const collectPoints = (child: Object3D) => {
    const mesh = child as Object3D & {
      isMesh?: boolean
      name?: string
      geometry?: {
        boundingBox: Box3 | null
        computeBoundingBox?: () => void
        attributes?: {
          position?: {
            count: number
            getX: (index: number) => number
            getY: (index: number) => number
            getZ: (index: number) => number
          }
        }
      }
      matrixWorld: Matrix4
    }

    if (mesh.isMesh && mesh.name !== 'cutout' && mesh.geometry) {
      if (!mesh.geometry.boundingBox && mesh.geometry.computeBoundingBox) {
        mesh.geometry.computeBoundingBox()
      }

      localMatrix.copy(inverseRootMatrix).multiply(mesh.matrixWorld)

      const vertexPositions = mesh.geometry.attributes?.position
      if (vertexPositions && vertexPositions.count > 0) {
        for (let index = 0; index < vertexPositions.count; index += 1) {
          scratchPosition
            .set(
              vertexPositions.getX(index),
              vertexPositions.getY(index),
              vertexPositions.getZ(index),
            )
            .applyMatrix4(localMatrix)

          if (Number.isFinite(scratchPosition.x) && Number.isFinite(scratchPosition.z)) {
            footprintPoints.push({ x: scratchPosition.x, y: scratchPosition.z })
          }
        }
      } else if (mesh.geometry.boundingBox) {
        scratchBounds.copy(mesh.geometry.boundingBox)
        scratchBounds.applyMatrix4(localMatrix)
        if (Number.isFinite(scratchBounds.min.x) && Number.isFinite(scratchBounds.max.x)) {
          footprintPoints.push(
            { x: scratchBounds.min.x, y: scratchBounds.min.z },
            { x: scratchBounds.max.x, y: scratchBounds.min.z },
            { x: scratchBounds.max.x, y: scratchBounds.max.z },
            { x: scratchBounds.min.x, y: scratchBounds.max.z },
          )
        }
      }
    }

    for (const grandchild of child.children) {
      collectPoints(grandchild)
    }
  }

  for (const child of object.children) {
    collectPoints(child)
  }

  return getMinimumAreaBoundingRect(footprintPoints) ?? []
}

export function computeMeshLocalBoundsFromObject(object: Object3D): MeshLocalBounds | null {
  object.updateWorldMatrix(true, true)

  const inverseRootMatrix = new Matrix4().copy(object.matrixWorld).invert()
  const localMatrix = new Matrix4()
  const localBounds = new Box3()
  const scratchBounds = new Box3()
  let hasBounds = false

  const expandBounds = (child: Object3D) => {
    const mesh = child as Object3D & {
      isMesh?: boolean
      name?: string
      geometry?: {
        boundingBox: Box3 | null
        computeBoundingBox?: () => void
      }
    }

    if (mesh.isMesh && mesh.name !== 'cutout' && mesh.geometry) {
      if (!mesh.geometry.boundingBox && mesh.geometry.computeBoundingBox) {
        mesh.geometry.computeBoundingBox()
      }

      if (mesh.geometry.boundingBox) {
        localMatrix.copy(inverseRootMatrix).multiply(mesh.matrixWorld)
        scratchBounds.copy(mesh.geometry.boundingBox).applyMatrix4(localMatrix)
        if (!hasBounds) {
          localBounds.copy(scratchBounds)
          hasBounds = true
        } else {
          localBounds.union(scratchBounds)
        }
      }
    }

    for (const grandchild of child.children) {
      expandBounds(grandchild)
    }
  }

  for (const child of object.children) {
    expandBounds(child)
  }

  if (!hasBounds) return null

  return {
    min: [localBounds.min.x, localBounds.min.y, localBounds.min.z],
    max: [localBounds.max.x, localBounds.max.y, localBounds.max.z],
  }
}

function getMinimumAreaBoundingRect(points: Point[]) {
  if (points.length === 0) return null
  if (points.length < 3) return points

  const hull = getConvexHull(points)
  if (hull.length < 3) return hull

  let bestArea = Number.POSITIVE_INFINITY
  let bestRect: Point[] | null = null

  for (let index = 0; index < hull.length; index += 1) {
    const nextIndex = (index + 1) % hull.length
    const current = hull[index]!
    const next = hull[nextIndex]!
    const angle = Math.atan2(next.y - current.y, next.x - current.x)
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of hull) {
      const rx = point.x * cos - point.y * sin
      const ry = point.x * sin + point.y * cos
      minX = Math.min(minX, rx)
      maxX = Math.max(maxX, rx)
      minY = Math.min(minY, ry)
      maxY = Math.max(maxY, ry)
    }

    const area = (maxX - minX) * (maxY - minY)
    if (area >= bestArea) continue
    bestArea = area

    const unrotate = (x: number, y: number): Point => ({
      x: x * Math.cos(angle) - y * Math.sin(angle),
      y: x * Math.sin(angle) + y * Math.cos(angle),
    })

    bestRect = [
      unrotate(minX, minY),
      unrotate(maxX, minY),
      unrotate(maxX, maxY),
      unrotate(minX, maxY),
    ]
  }

  return bestRect
}

function getConvexHull(points: Point[]) {
  if (points.length <= 1) return points

  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Point[] = []
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

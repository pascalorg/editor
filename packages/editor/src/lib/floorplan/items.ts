import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  type ItemNode,
  type LevelNode,
  sceneRegistry,
  useLiveTransforms,
} from '@pascal-app/core'
import type { Object3D } from 'three'
import { Box3, Matrix4, Vector3 } from 'three'
import { getRotatedRectanglePolygon, rotatePlanVector } from './geometry'
import type { FloorplanItemEntry, FloorplanNodeTransform, LevelDescendantMap } from './types'

export function collectLevelDescendants(
  levelNode: LevelNode,
  nodes: Record<string, AnyNode>,
): AnyNode[] {
  const descendants: AnyNode[] = []
  const stack = [...levelNode.children].reverse() as AnyNodeId[]

  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId) {
      continue
    }

    const node = nodes[nodeId]
    if (!node) {
      continue
    }

    descendants.push(node)

    if ('children' in node && Array.isArray(node.children) && node.children.length > 0) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index] as AnyNodeId)
      }
    }
  }

  return descendants
}

export function getItemFloorplanTransform(
  item: ItemNode,
  nodeById: LevelDescendantMap,
  cache: Map<string, FloorplanNodeTransform | null>,
): FloorplanNodeTransform | null {
  const cached = cache.get(item.id)
  if (cached !== undefined) {
    return cached
  }

  const localRotation = item.rotation[1] ?? 0
  let result: FloorplanNodeTransform | null = null
  const itemMetadata =
    typeof item.metadata === 'object' && item.metadata !== null && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null

  if (itemMetadata?.isTransient === true) {
    const live = useLiveTransforms.getState().get(item.id)
    if (live) {
      result = {
        position: {
          x: live.position[0],
          y: live.position[2],
        },
        rotation: live.rotation,
      }

      cache.set(item.id, result)
      return result
    }
  }

  if (item.parentId) {
    const parentNode = nodeById.get(item.parentId as AnyNodeId)

    if (parentNode?.type === 'wall') {
      const wallRotation = -Math.atan2(
        parentNode.end[1] - parentNode.start[1],
        parentNode.end[0] - parentNode.start[0],
      )
      const wallLocalZ =
        item.asset.attachTo === 'wall-side'
          ? ((parentNode.thickness ?? 0.1) / 2) * (item.side === 'back' ? -1 : 1)
          : item.position[2]
      const [offsetX, offsetY] = rotatePlanVector(item.position[0], wallLocalZ, wallRotation)

      result = {
        position: {
          x: parentNode.start[0] + offsetX,
          y: parentNode.start[1] + offsetY,
        },
        rotation: wallRotation + localRotation,
      }
    } else if (parentNode?.type === 'item') {
      const parentTransform = getItemFloorplanTransform(parentNode, nodeById, cache)
      if (parentTransform) {
        const [offsetX, offsetY] = rotatePlanVector(
          item.position[0],
          item.position[2],
          parentTransform.rotation,
        )
        result = {
          position: {
            x: parentTransform.position.x + offsetX,
            y: parentTransform.position.y + offsetY,
          },
          rotation: parentTransform.rotation + localRotation,
        }
      }
    } else {
      result = {
        position: { x: item.position[0], y: item.position[2] },
        rotation: localRotation,
      }
    }
  } else {
    result = {
      position: { x: item.position[0], y: item.position[2] },
      rotation: localRotation,
    }
  }

  cache.set(item.id, result)
  return result
}

export function buildFloorplanItemEntry(
  item: ItemNode,
  nodeById: LevelDescendantMap,
  cache: Map<string, FloorplanNodeTransform | null>,
): FloorplanItemEntry | null {
  const transform = getItemFloorplanTransform(item, nodeById, cache)
  if (!transform) {
    return null
  }

  const object = sceneRegistry.nodes.get(item.id)
  const realMeshPolygon = object
    ? getRealMeshFloorplanPolygon(transform, object)
    : getCachedMeshFloorplanPolygon(item, transform)
  if (!realMeshPolygon) {
    return null
  }

  const dimensionPolygon = getItemDimensionPolygon(item, transform)

  return {
    dimensionPolygon,
    item,
    polygon: realMeshPolygon,
    usesRealMesh: realMeshPolygon !== null,
  }
}

type Point = {
  x: number
  y: number
}

function getItemDimensionPolygon(item: ItemNode, transform: FloorplanNodeTransform): Point[] {
  const [width, , depth] = getScaledDimensions(item)
  const centerLocalZ = item.asset.attachTo === 'wall-side' ? -depth / 2 : 0
  const [offsetX, offsetY] = rotatePlanVector(0, centerLocalZ, transform.rotation)

  return getRotatedRectanglePolygon(
    {
      x: transform.position.x + offsetX,
      y: transform.position.y + offsetY,
    },
    width,
    depth,
    transform.rotation,
  )
}

function getCachedLocalMeshPolygon(item: ItemNode): Point[] | null {
  const metadata =
    typeof item.metadata === 'object' && item.metadata !== null && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null
  const rawPolygon = metadata?.floorplanLocalPolygon
  if (!Array.isArray(rawPolygon)) {
    return null
  }

  const polygon = rawPolygon.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return []
    }
    const x = point[0]
    const y = point[1]
    return typeof x === 'number' && typeof y === 'number' ? [{ x, y }] : []
  })

  return polygon.length >= 3 ? polygon : null
}

function getCachedMeshFloorplanPolygon(item: ItemNode, transform: FloorplanNodeTransform) {
  const localPolygon = getCachedLocalMeshPolygon(item)
  if (!localPolygon) {
    return null
  }

  return localPolygon.map((corner) => {
    const [offsetX, offsetY] = rotatePlanVector(corner.x, corner.y, transform.rotation)
    return {
      x: transform.position.x + offsetX,
      y: transform.position.y + offsetY,
    }
  })
}

function getRealMeshFloorplanPolygon(transform: FloorplanNodeTransform, object: Object3D) {
  const localPolygon = getLocalMeshFloorplanPolygon(object)
  if (localPolygon.length === 0) {
    return null
  }

  return localPolygon.map((corner) => {
    const [offsetX, offsetY] = rotatePlanVector(corner.x, corner.y, transform.rotation)
    return {
      x: transform.position.x + offsetX,
      y: transform.position.y + offsetY,
    }
  })
}

function getLocalMeshFloorplanPolygon(object: Object3D): Point[] {
  object.updateWorldMatrix(true, true)

  const inverseRootMatrix = new Matrix4().copy(object.matrixWorld).invert()
  const localMatrix = new Matrix4()
  const scratchBounds = new Box3()
  const scratchPosition = new Vector3()
  const registeredNodeObjects = new Set(sceneRegistry.nodes.values())
  const footprintPoints: Point[] = []

  const collectPoints = (child: Object3D) => {
    if (child !== object && registeredNodeObjects.has(child)) {
      return
    }

    const mesh = child as {
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

function getMinimumAreaBoundingRect(points: Point[]) {
  if (points.length === 0) {
    return null
  }

  const hull = getConvexHull(points)
  if (hull.length === 0) {
    return null
  }

  if (hull.length === 1) {
    const point = hull[0]!
    return [point, point, point, point]
  }

  if (hull.length === 2) {
    const [start, end] = hull
    return [start!, end!, end!, start!]
  }

  let bestArea = Number.POSITIVE_INFINITY
  let bestRect: Point[] | null = null

  for (let index = 0; index < hull.length; index += 1) {
    const start = hull[index]!
    const end = hull[(index + 1) % hull.length]!
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
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
    if (area >= bestArea) {
      continue
    }

    bestRect = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ].map((point) => ({
      x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
      y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
    }))
    bestArea = area
  }

  return bestRect
}

function getConvexHull(points: Point[]) {
  const uniquePoints = Array.from(
    new Map(points.map((point) => [`${point.x.toFixed(6)}:${point.y.toFixed(6)}`, point])).values(),
  ).sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  if (uniquePoints.length <= 1) {
    return uniquePoints
  }

  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)

  const lower: Point[] = []
  for (const point of uniquePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Point[] = []
  for (let index = uniquePoints.length - 1; index >= 0; index -= 1) {
    const point = uniquePoints[index]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  type ItemNode,
  type LevelNode,
  useLiveTransforms,
} from '@pascal-app/core'
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

  // Polygon is derived purely from `dimensions` — the same source of truth the
  // editor uses for placement / collision. Previously we ran a per-frame
  // convex-hull / minimum-area-rect pass over the loaded mesh's vertices to
  // produce a tighter polygon, but that's expensive and disagrees with what
  // the user sees on the 3D side (their dimensions are intentionally the
  // bounding box, sometimes hand-tuned).
  const dimensionPolygon = getItemDimensionPolygon(item, transform)
  const [width, , depth] = getScaledDimensions(item)

  return {
    dimensionPolygon,
    item,
    polygon: dimensionPolygon,
    usesRealMesh: false,
    center: transform.position,
    rotation: transform.rotation,
    width,
    depth,
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

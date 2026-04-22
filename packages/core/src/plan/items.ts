import { getScaledDimensions } from '../schema'
import type { AnyNode, AnyNodeId, ItemNode, LevelNode } from '../schema'
import useLiveTransforms from '../store/use-live-transforms'
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

  const [width, , depth] = getScaledDimensions(item)
  return {
    item,
    polygon: getRotatedRectanglePolygon(transform.position, width, depth, transform.rotation),
  }
}

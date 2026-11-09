import {
  type AnyNode,
  getScaledDimensions,
  type ItemNode,
  type LiveTransformLike,
  type PlacementNotice,
} from '@pascal-app/core'
import { type FloorItemMisfit, floorItemFit } from '@pascal-app/core/building'

const round = (value: number) => Math.round(value * 100) / 100

/** What a person reads for a floor item that does not fit: in a door's way, or too large for its room. */
export function floorItemMisfitNotice(
  misfit: FloorItemMisfit,
  dimensions: readonly number[],
): PlacementNotice {
  const name = misfit.room?.name.trim()
  if (misfit.code === 'blocks_door')
    return { line: name ? `Blocks the door to ${name}` : 'Blocks a door' }
  return {
    line: name ? `Too large for ${name}` : 'Too large for its room',
    detail: `${round(dimensions[0] ?? 0)} × ${round(dimensions[2] ?? 0)} m in a ${round(misfit.room.width)} × ${round(misfit.room.depth)} m room`,
  }
}

/**
 * The item's `placementNotice`: a floor item in a door's way or too large for its room, by the
 * check place_items refuses with (`floorItemFit`), at its live pose while it is placed or moved.
 * An item on a table, a shelf or a wall is not checked.
 */
export function itemPlacementNotice(
  node: ItemNode,
  { nodes, live }: { nodes: Readonly<Record<string, AnyNode>>; live?: LiveTransformLike },
): PlacementNotice | null {
  if (!node.parentId || nodes[node.parentId]?.type !== 'level') return null
  const item: ItemNode = live
    ? {
        ...node,
        position: live.position,
        rotation: [node.rotation[0], live.rotation, node.rotation[2]],
      }
    : node
  const dimensions = getScaledDimensions(item)
  const misfit = floorItemFit(nodes, {
    levelId: node.parentId,
    x: item.position[0],
    z: item.position[2],
    rotationDeg: ((item.rotation?.[1] ?? 0) * 180) / Math.PI,
    dimensions,
  })
  return misfit ? floorItemMisfitNotice(misfit, dimensions) : null
}

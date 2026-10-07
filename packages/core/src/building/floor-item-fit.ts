import {
  collectDoorKeepouts,
  type DoorKeepout,
  itemBlocksDoorKeepout,
  itemPlanAabb,
} from '../agent-operations/door-clearance'
import { findValidPlacement } from '../agent-operations/layout-clearance'
import { pointInPolygon, polygonBounds, type Vec2 } from '../agent-operations/plan-geometry'
import type { SceneNodes } from '../agent-operations/types'
import { type AnyNode, getScaledDimensions, type ItemNode, type ZoneNode } from '../schema'

export type FloorItemRoom = { id: string; name: string; width: number; depth: number }

export type FloorItemMisfit =
  | { code: 'too_large_for_room'; room: FloorItemRoom }
  | {
      code: 'blocks_door'
      room?: FloorItemRoom
      doorId: string
      /** A spot in the room that clears every door, when there is one. */
      candidate?: { x: number; z: number; rotationDeg: number }
    }

const round = (value: number) => Math.round(value * 100) / 100

/**
 * Whether a floor item fits where it stands. An item its room cannot hold in any turn, or one
 * standing in the space a door needs (as verify_scene's blocked-door check sees it), does not fit.
 * place_items refuses it, the editor warns. Items overlapping is not a misfit: a chair under its
 * table and a bed on its rug overlap by design.
 */
export function floorItemFit(
  nodes: SceneNodes,
  item: {
    levelId: string
    x: number
    z: number
    rotationDeg: number
    dimensions: readonly number[] | undefined
    /** The level's door keepouts, when the caller already has them. */
    doors?: DoorKeepout[]
  },
): FloorItemMisfit | null {
  const zone = Object.values(nodes).find(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.parentId === item.levelId &&
      node.polygon.length >= 3 &&
      pointInPolygon([item.x, item.z], node.polygon as Vec2[]),
  )
  const bounds = zone ? polygonBounds(zone.polygon as Vec2[]) : undefined
  const room = zone &&
    bounds && {
      id: zone.id,
      name: zone.name,
      width: bounds.maxX - bounds.minX,
      depth: bounds.maxZ - bounds.minZ,
    }
  const [width = 1, , depth = 1] = item.dimensions ?? [1, 1, 1]
  if (room) {
    const fits = (a: number, b: number) => a <= room.width && b <= room.depth
    if (!fits(width, depth) && !fits(depth, width)) return { code: 'too_large_for_room', room }
  }
  const doors = item.doors ?? collectDoorKeepouts(Object.values(nodes), { levelId: item.levelId })
  const footprint = itemPlanAabb(
    [item.x, 0, item.z],
    item.dimensions as number[] | undefined,
    (item.rotationDeg * Math.PI) / 180,
  )
  const door = doors.find((keepout) => itemBlocksDoorKeepout(footprint, keepout))
  if (!door) return null
  const { candidate } = findValidPlacement({
    primary: { x: item.x, z: item.z, rotationDeg: item.rotationDeg },
    dimensions: item.dimensions as number[] | undefined,
    doorKeepouts: doors.map((keepout) => keepout.aabb),
    occupied: [],
    roomBounds: bounds,
  })
  return {
    code: 'blocks_door',
    ...(room ? { room } : {}),
    doorId: door.doorId,
    ...(candidate ? { candidate } : {}),
  }
}

/**
 * The warning a person reads for a floor item that does not fit, in the HUD while placing it and
 * in its panel once placed; null for one that fits, or one not standing on the floor.
 */
export function floorItemWarning(
  nodes: Readonly<Record<string, AnyNode>>,
  item: ItemNode,
): { line: string; detail?: string } | null {
  if (nodes[item.parentId ?? '']?.type !== 'level') return null
  const dimensions = getScaledDimensions(item)
  const misfit = floorItemFit(nodes as SceneNodes, {
    levelId: item.parentId!,
    x: item.position[0],
    z: item.position[2],
    rotationDeg: ((item.rotation?.[1] ?? 0) * 180) / Math.PI,
    dimensions,
  })
  if (!misfit) return null
  const name = misfit.room?.name.trim()
  if (misfit.code === 'blocks_door')
    return { line: name ? `Blocks the door to ${name}` : 'Blocks a door' }
  return {
    line: name ? `Too large for ${name}` : 'Too large for its room',
    detail: `${round(dimensions[0])} × ${round(dimensions[2])} m in a ${round(misfit.room.width)} × ${round(misfit.room.depth)} m room`,
  }
}

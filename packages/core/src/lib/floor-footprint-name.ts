import type { AnyNode, SlabNode, ZoneNode } from '../schema'
import { floorFootprintCreatorId } from './floor-footprint-key'
import { area } from './polygon-boolean'

const GENERATED_NAME = /^(floor plate|slab|floor)\b|slab$/i

const polygonArea = (outer: SlabNode['polygon'], holes: SlabNode['holes'] = []) =>
  area([{ outer, holes }])

/**
 * What a base-plate footprint is called everywhere (panel, "Sits on", scene
 * graph, MCP messages). Never "Floor N": that reads as a level. A name the
 * user gave the plate wins; the level's largest multi-room footprint is the
 * "Shared floor". Keyed floors use their creator's current name while that
 * room remains on the key, including disconnected pieces. Otherwise use the
 * largest named room ("Kitchen floor"), or "Floor area" with no rooms.
 */
export function floorFootprintName(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): string {
  const naming = floorFootprintNaming(nodes, plate)
  switch (naming.kind) {
    case 'named':
      return naming.name
    case 'room':
      return `${naming.room} floor`
    case 'shared':
      return 'Shared floor'
    case 'area':
      return 'Floor area'
  }
}

/**
 * How `floorFootprintName` arrives at its name, so a UI can word it in its
 * language: `named` is the plate's own name (or a room name that already
 * ends in "floor") and shows as is; `room` is "<room> floor".
 */
export type FloorFootprintNaming =
  | { kind: 'named'; name: string }
  | { kind: 'room'; room: string }
  | { kind: 'shared' }
  | { kind: 'area' }

export function floorFootprintNaming(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): FloorFootprintNaming {
  const own = plate.name?.trim()
  if (own && !GENERATED_NAME.test(own)) return { kind: 'named', name: own }
  const rooms = (plate.zoneIds ?? [])
    .flatMap((id) => {
      const zone = nodes[id]
      return zone?.type === 'zone' && zone.spaceRole === 'room' && zone.floor?.support !== 'open'
        ? [zone as ZoneNode]
        : []
    })
    .sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon) || a.id.localeCompare(b.id))
  if (
    rooms.length > 1 &&
    !rooms.some((room) => room.floor?.footprint) &&
    isLargestFootprint(nodes, plate)
  )
    return { kind: 'shared' }
  const key = rooms.find((room) => room.floor?.footprint)?.floor?.footprint
  const creatorId = key && floorFootprintCreatorId(key)
  const creator = creatorId ? nodes[creatorId] : undefined
  const creatorName =
    creator?.type === 'zone' &&
    creator.spaceRole === 'room' &&
    creator.parentId === plate.parentId &&
    creator.floor?.footprint === key &&
    creator.floor?.support !== 'open' &&
    !creator.floor?.sourceSlabId &&
    creator.hasFloor !== false
      ? creator.name?.trim()
      : undefined
  const named = creatorName || rooms.map((room) => room.name?.trim()).find(Boolean)
  if (!named)
    return rooms.some((room) => room.floor?.footprint) ? { kind: 'shared' } : { kind: 'area' }
  return /\bfloor$/i.test(named) ? { kind: 'named', name: named } : { kind: 'room', room: named }
}

function isLargestFootprint(nodes: Readonly<Record<string, AnyNode>>, plate: SlabNode) {
  const largest = Object.values(nodes)
    .filter(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && node.parentId === plate.parentId,
    )
    .sort(
      (a, b) =>
        polygonArea(b.polygon, b.holes) - polygonArea(a.polygon, a.holes) ||
        a.id.localeCompare(b.id),
    )[0]
  return !largest || largest.id === plate.id
}

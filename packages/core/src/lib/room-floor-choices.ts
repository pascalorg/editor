import { boundaries, roomFace } from '../commands/structure/shared'
import type { AnyNode, SlabNode } from '../schema'
import { floorFootprintName } from './floor-footprint-name'
import { floorRoomFaces } from './floor-room-faces'
import { area, intersection, union } from './polygon-boolean'
import { roomDrawnFloor } from './room-drawn-floor'

export type RoomFloorChoice = {
  key: string | null
  plateId: string
  name: string
  current: boolean
  drawn?: boolean
  mezzanine?: boolean
}

export function roomFloorChoices(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
): RoomFloorChoice[] {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || zone.spaceRole !== 'room' || !zone.parentId) return []
  const drawn = roomDrawnFloor(nodes, zoneId)
  const faces = floorRoomFaces(boundaries(nodes, zone.parentId))
  const face = roomFace(nodes, zone, faces)
  const adjacent = new Set<string>([zoneId])
  for (const room of Object.values(nodes)) {
    if (room.type !== 'zone' || room.parentId !== zone.parentId) continue
    if (
      roomFace(nodes, room, faces)?.spans.some((other) =>
        face?.spans.some(
          (span) =>
            span.boundaryId === other.boundaryId &&
            span.face !== other.face &&
            Math.min(span.t1, other.t1) - Math.max(span.t0, other.t0) > 1e-6,
        ),
      )
    )
      adjacent.add(room.id)
  }
  const footprint = { outer: zone.polygon, holes: zone.holes }
  const plates = Object.values(nodes).filter((node): node is SlabNode => {
    if (node.type !== 'slab' || node.parentId !== zone.parentId) return false
    if (node.id === drawn?.slabId) return true
    if (node.support === 'open') return !!node.zoneIds?.includes(zoneId)
    if (node.plateRole !== 'base') return false
    if (node.zoneIds?.some((id) => adjacent.has(id))) return true
    const plate = { outer: node.polygon, holes: node.holes }
    return area(intersection(footprint, plate)) > 1e-6 || union([footprint, plate]).length === 1
  })
  const choices = plates
    .map((plate): RoomFloorChoice => {
      const owner = (plate.zoneIds ?? [])
        .map((id) => nodes[id])
        .find((node) => node?.type === 'zone')
      return {
        key: owner?.type === 'zone' ? (owner.floor?.footprint ?? null) : null,
        plateId: plate.id,
        name: floorFootprintName(nodes, plate),
        current: drawn ? plate.id === drawn.slabId : !!plate.zoneIds?.includes(zoneId),
        ...(plate.id === drawn?.slabId ? { drawn: true } : {}),
        ...(plate.support === 'open' ? { mezzanine: true } : {}),
      }
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || a.plateId.localeCompare(b.plateId))
  const seen = new Set<string>()
  return choices.filter((choice) => {
    const identity = choice.key ?? choice.plateId
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

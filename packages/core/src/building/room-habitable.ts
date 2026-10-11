import type { AnyNode, ZoneNode } from '../schema'
import { pointInPolygon } from '../systems/slab/slab-support'

/**
 * The rooms owed a window: bedrooms, living and dining rooms, a kitchen of its own; never a
 * bathroom, a closet or walk-in, a laundry, a corridor or storage, which a facade must not force
 * (settled with the MCP session on the Victor, 2026-10-03). Zones carry no use, so the name says.
 */
const HABITABLE_ROOM =
  /bed|living|lounge|family|dining|kitchen|study|office|chambre|séjour|salon|cuisine/i
const NOT_OWED_ROOM =
  /bath|wc|toilet|shower|powder|closet|walk|wardrobe|dressing|laundry|utility|stor|pantry|corridor|hall|entry|foyer|lobby|stair|lift|elevator|shaft|core|garage/i
export const isHabitableRoomName = (name: string) =>
  HABITABLE_ROOM.test(name) && !NOT_OWED_ROOM.test(name)

export const polygonArea = (points: readonly (readonly number[])[]) =>
  Math.abs(
    points.reduce((sum, [x, z], i) => {
      const [nx, nz] = points[(i + 1) % points.length]!
      return sum + x! * nz! - nx! * z!
    }, 0),
  ) / 2

const centre = (zone: ZoneNode): [number, number] => {
  const n = zone.polygon.length || 1
  return zone.polygon.reduce(([x, z], [px, pz]) => [x + px / n, z + pz / n] as [number, number], [
    0, 0,
  ] as [number, number])
}

/** A floor's room zones. */
export const roomZonesOn = (nodes: Readonly<Record<string, AnyNode>>, levelId: string) =>
  Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' && node.parentId === levelId && node.spaceRole === 'room',
  )

/**
 * Whether a room zone is owed a window: a habitable room by its name, or an apartment with no rooms
 * laid out inside (a dwelling, as most of the Victor's apartments, only their own zone "401").
 */
export function owedRoom(nodes: Readonly<Record<string, AnyNode>>, zones: readonly ZoneNode[]) {
  const members = new Set(
    Object.values(nodes).flatMap((node) => (node.type === 'unit' ? node.members : [])),
  )
  // A room is inside an apartment when its centre is: rooms share the apartment's edges.
  const dwelling = (zone: ZoneNode) =>
    members.has(zone.id) &&
    !NOT_OWED_ROOM.test(zone.name) &&
    !zones.some(
      (other) =>
        other !== zone &&
        polygonArea(other.polygon) < polygonArea(zone.polygon) &&
        pointInPolygon(...centre(other), zone.polygon as [number, number][]),
    )
  return (zone: ZoneNode) => isHabitableRoomName(zone.name) || dwelling(zone)
}

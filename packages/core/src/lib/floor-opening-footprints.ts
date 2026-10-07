import type { AnyNode, DoorNode, WallNode, WindowNode } from '../schema'
import { getWallCurveFrameAt, getWallCurveLength, isCurvedWall } from '../systems/wall/wall-curve'
import type { PlateRoom } from './floor-plates'
import { openingFitsAtDatum } from './opening-floor-datum'
import { difference, intersection, type MultiPolygon, type Ring, union } from './polygon-boolean'

export function isFloorAnchoredOpening(
  opening: Pick<DoorNode | WindowNode, 'position' | 'height'> &
    Partial<Pick<DoorNode | WindowNode, 'verticalAnchor'>>,
) {
  if (opening.verticalAnchor) return opening.verticalAnchor === 'floor'
  return opening.position[1] - opening.height / 2 <= 0.01
}

/**
 * The wall's `from`–`to` span as a plan band reaching well past both faces
 * (and any justification offset). A wall cutter must overshoot the body it
 * removes: a cutter whose sides coincide with the wall faces leaves the CSG
 * subtraction coplanar, which silently drops the cut.
 */
export function wallOpeningBand(wall: WallNode, from: number, to: number): Ring {
  if (to <= from) return []
  const count = isCurvedWall(wall) ? Math.max(2, Math.ceil((to - from) * 96)) : 1
  const width = Math.max(wall.thickness ?? 0.15, 0.15) * 2
  const sides = [1, -1].map((sign) =>
    Array.from({ length: count + 1 }, (_, i): [number, number] => {
      const frame = getWallCurveFrameAt(wall, from + ((to - from) * i) / count)
      return [
        frame.point.x + frame.normal.x * width * sign,
        frame.point.y + frame.normal.y * width * sign,
      ]
    }),
  )
  return [...sides[0]!, ...sides[1]!.reverse()]
}

export function wallOpeningFootprint(
  wall: WallNode,
  footprint: Ring,
  from: number,
  to: number,
): MultiPolygon {
  if (to <= from || !footprint.length) return []
  return intersection(footprint, wallOpeningBand(wall, from, to))
}

export function openingAperture(
  wall: WallNode,
  opening: Pick<DoorNode | WindowNode, 'position' | 'width'>,
  footprints: ReadonlyMap<string, Ring>,
): MultiPolygon {
  const length = getWallCurveLength(wall)
  if (length < 1e-9) return []
  const from = Math.max(0, (opening.position[0] - opening.width / 2) / length)
  const to = Math.min(1, (opening.position[0] + opening.width / 2) / length)
  const aperture = wallOpeningFootprint(wall, footprints.get(wall.id) ?? [], from, to)
  const points = aperture.flatMap((part) => part.outer)
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1])
  const minX = Math.min(...xs) - 0.0001,
    maxX = Math.max(...xs) + 0.0001
  const minZ = Math.min(...zs) - 0.0001,
    maxZ = Math.max(...zs) + 0.0001
  const neighbours = [...footprints]
    .filter(
      ([id, ring]) =>
        id !== wall.id &&
        Math.max(...ring.map((p) => p[0])) >= minX &&
        Math.min(...ring.map((p) => p[0])) <= maxX &&
        Math.max(...ring.map((p) => p[1])) >= minZ &&
        Math.min(...ring.map((p) => p[1])) <= maxZ,
    )
    .map(([, ring]) => ring)
  return difference(aperture, neighbours.length ? union(neighbours) : [])
}

export type OpeningLanding = {
  openingId: string
  wallId: string
  zoneId: string
  elevation: number
  polygons: MultiPolygon
  exterior: boolean
}

export function openingLandings(
  rooms: PlateRoom[],
  elevationOf: (room: PlateRoom) => number,
  nodes: Readonly<Record<string, AnyNode>>,
  apertures?: ReadonlyMap<string, MultiPolygon>,
): OpeningLanding[] {
  const result: OpeningLanding[] = []
  const context = rooms[0]?.context
  if (!context) return result
  for (const wall of context.walls.values()) {
    const length = getWallCurveLength(wall)
    if (length < 1e-9) continue
    const spans = rooms.flatMap((room) =>
      room.spans.filter((span) => span.boundaryId === wall.id).map((span) => ({ room, span })),
    )
    for (const id of wall.children ?? []) {
      const opening = nodes[id]
      if (
        (opening?.type !== 'door' && opening?.type !== 'window') ||
        !isFloorAnchoredOpening(opening)
      )
        continue
      const chord = (station: number) => {
        const { point } = getWallCurveFrameAt(wall, station / length)
        const dx = wall.end[0] - wall.start[0],
          dz = wall.end[1] - wall.start[1]
        return (
          ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) / (dx * dx + dz * dz)
        )
      }
      const from = Math.max(0, chord(opening.position[0] - opening.width / 2))
      const to = Math.min(1, chord(opening.position[0] + opening.width / 2))
      const cuts = [
        ...new Set([
          from,
          to,
          ...spans.flatMap(({ span }) => [span.t0, span.t1]).filter((t) => t > from && t < to),
        ]),
      ].sort((a, b) => a - b)
      const facing = spans.filter(
        ({ span }) => Math.min(to, span.t1) - Math.max(from, span.t0) > 1e-7,
      )
      const carried = cuts
        .slice(1)
        .every((end, i) =>
          ['a', 'b'].every((face) =>
            facing.some(
              ({ span }) =>
                span.face === face &&
                span.t0 <= (end + cuts[i]!) / 2 &&
                span.t1 >= (end + cuts[i]!) / 2,
            ),
          ),
        )
      const exterior =
        facing.length > 0 &&
        facing.every(
          ({ room, span }) =>
            room.zone.id === facing[0]!.room.zone.id && span.face === facing[0]!.span.face,
        ) &&
        cuts
          .slice(1)
          .every((end, i) =>
            facing.some(
              ({ span }) => span.t0 <= (end + cuts[i]!) / 2 && span.t1 >= (end + cuts[i]!) / 2,
            ),
          )
      if (!carried && !exterior) continue
      const owner = facing
        .map(({ room }) => room)
        .sort((a, b) => {
          const delta = elevationOf(b) - elevationOf(a)
          return Math.abs(delta) > 0.001 ? delta : a.zone.id.localeCompare(b.zone.id)
        })[0]
      if (!owner) continue
      if (!openingFitsAtDatum(wall, opening, elevationOf(owner), nodes)) continue
      result.push({
        openingId: id,
        wallId: wall.id,
        zoneId: owner.zone.id,
        elevation: elevationOf(owner),
        exterior,
        polygons: apertures?.get(id) ?? openingAperture(wall, opening, context.wallFootprints),
      })
    }
  }
  return result
}

export function floorOpeningFootprints(
  rooms: PlateRoom[],
  elevationOf: (room: PlateRoom) => number,
  nodes: Readonly<Record<string, AnyNode>>,
): Map<string, MultiPolygon> {
  const result = new Map<string, MultiPolygon>()
  for (const landing of openingLandings(rooms, elevationOf, nodes)) {
    // Exterior ownership changes paint, not the existing step footprint.
    if (landing.exterior) continue
    result.set(landing.zoneId, union([result.get(landing.zoneId) ?? [], landing.polygons]))
  }
  return result
}

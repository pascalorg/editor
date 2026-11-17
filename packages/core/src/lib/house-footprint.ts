import type { ZoneNode } from '../schema'
import { type MultiPolygon, type Polygon, union } from './polygon-boolean'

/**
 * The connected house includes floorless wings without making them floor plates.
 * Callers scope rooms and sibling base footprints to the seed's level.
 */
export function connectedHouseFootprint(
  seed: Polygon,
  rooms: readonly ZoneNode[],
  siblingFootprints: readonly Polygon[] = [],
): {
  footprint: MultiPolygon
  floorlessRooms: ZoneNode[]
  connectedFootprintIndices: number[]
} {
  const candidates: Array<{ polygon: Polygon; room?: ZoneNode; index?: number }> = [
    ...rooms
      .filter(
        (room) =>
          room.spaceRole === 'room' &&
          room.hasFloor === false &&
          room.floor?.support !== 'open' &&
          room.polygon.length >= 3,
      )
      .map((room) => ({
        polygon: { outer: room.polygon, holes: room.holes ?? [] },
        room,
      })),
    ...siblingFootprints.map((polygon, index) => ({
      polygon,
      index,
    })),
  ]
  const parts = [seed]
  const floorlessRooms: ZoneNode[] = []
  const connectedFootprintIndices: number[] = []
  const bounds = (polygon: Polygon) => ({
    minX: Math.min(...polygon.outer.map(([x]) => x)),
    minZ: Math.min(...polygon.outer.map(([, z]) => z)),
    maxX: Math.max(...polygon.outer.map(([x]) => x)),
    maxZ: Math.max(...polygon.outer.map(([, z]) => z)),
  })
  const connects = (a: Polygon, b: Polygon) => {
    const left = bounds(a),
      right = bounds(b)
    if (
      left.minX > right.maxX ||
      right.minX > left.maxX ||
      left.minZ > right.maxZ ||
      right.minZ > left.maxZ
    )
      return false
    // Polygon union joins shared edges and area, but keeps corner-only contacts separate.
    return union([a, b]).length === 1
  }
  for (let cursor = 0; cursor < parts.length; cursor++) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i]!
      if (!connects(parts[cursor]!, candidate.polygon)) continue
      parts.push(candidate.polygon)
      if (candidate.room) floorlessRooms.push(candidate.room)
      if (candidate.index !== undefined) connectedFootprintIndices.push(candidate.index)
      candidates.splice(i, 1)
    }
  }
  return {
    footprint: union(parts),
    floorlessRooms,
    connectedFootprintIndices: connectedFootprintIndices.sort((a, b) => a - b),
  }
}

import { type ExtractedRoom, extractRooms } from './room-graph'
import type { BoundaryNode } from './room-topology-index'

const facesByGeometry = new Map<string, ExtractedRoom[]>()

export function floorRoomFaces(boundaries: BoundaryNode[]): ExtractedRoom[] {
  const ordered = [...boundaries].sort((a, b) => a.id.localeCompare(b.id))
  const signature = JSON.stringify(
    ordered.map((boundary) => [
      boundary.id,
      boundary.type,
      boundary.start,
      boundary.end,
      boundary.type === 'wall'
        ? [boundary.curveOffset, boundary.thickness, boundary.justification]
        : null,
    ]),
  )
  const cached = facesByGeometry.get(signature)
  if (cached) return cached
  const faces = extractRooms(ordered)
  facesByGeometry.set(signature, faces)
  if (facesByGeometry.size > 64) facesByGeometry.delete(facesByGeometry.keys().next().value!)
  return faces
}

export function roomPolygonKey(
  polygon: readonly (readonly number[])[],
  holes: readonly (readonly (readonly number[])[])[] = [],
): string {
  const ring = (points: readonly (readonly number[])[]) =>
    points
      .map(([x, z]) => `${Math.round(x! * 1e6)},${Math.round(z! * 1e6)}`)
      .sort()
      .join(';')
  return [ring(polygon), ...holes.map(ring).sort()].join('|')
}

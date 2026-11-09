import { polygonInteriorPoint } from '../../lib/polygon-label'
import {
  conflict,
  type Point,
  requireZone,
  type StructureNodes,
  type StructurePlan,
} from './shared'
import { validateMezzanine } from './validate-mezzanine'

export type MezzanineEdgeInput = { zoneId: string; edgeIndex: number; distance: number }

export function resizeMezzanine(nodes: StructureNodes, input: MezzanineEdgeInput): StructurePlan {
  const zone = requireZone(nodes, input.zoneId)
  if (zone.floor?.support !== 'open')
    return conflict('invalid-edge', [zone.id], 'Polygon edge pushes require a mezzanine.')
  const { edgeIndex, distance } = input
  if (
    !Number.isInteger(edgeIndex) ||
    edgeIndex < 0 ||
    edgeIndex >= zone.polygon.length ||
    !Number.isFinite(distance)
  )
    return conflict(
      'invalid-edge',
      [zone.id],
      'Use a polygon edge index and a finite distance in metres.',
    )
  const polygon = zone.polygon.map((p): Point => [...p])
  const nextIndex = (edgeIndex + 1) % polygon.length
  const start = polygon[edgeIndex]!,
    end = polygon[nextIndex]!
  const dx = end[0] - start[0],
    dz = end[1] - start[1],
    length = Math.hypot(dx, dz)
  if (length < 1e-6) return conflict('too-small', [zone.id], 'The edge has no length.')
  const winding = Math.sign(
    polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length]!
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0),
  )
  for (const index of [edgeIndex, nextIndex]) {
    const point = polygon[index]!
    polygon[index] = [
      point[0] + ((winding * dz) / length) * distance + 0,
      point[1] - ((winding * dx) / length) * distance + 0,
    ]
  }
  const invalid = validateMezzanine(nodes, { ...zone, polygon }, zone.id)
  if (invalid) return { changes: [], conflicts: [invalid] }
  return {
    changes: [
      {
        op: 'update',
        id: zone.id,
        data: { polygon, seed: polygonInteriorPoint({ polygon }, true) },
      },
    ],
  }
}

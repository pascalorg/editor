import {
  type FloorplanGeometry,
  area as footprintArea,
  type GeometryContext,
  polygonInteriorPoint,
  type ZoneNode,
} from '@pascal-app/core'
import { formatAreaLabel } from '@pascal-app/editor'

export function buildZoneContextualDimensions(
  node: ZoneNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.autoFromWalls && node.enclosureStatus === 'open') return null
  const polygon = node.polygon
  if (polygon.length < 3) return null
  const area = footprintArea([{ outer: polygon, holes: node.holes ?? [] }])
  const centroid = polygonInteriorPoint(node, true)
  if (area <= 1e-6) return null

  return {
    kind: 'dimension-label',
    appearance: 'outlined',
    cx: centroid[0],
    cy: centroid[1],
    text: formatAreaLabel(area, ctx.viewState?.unit ?? 'metric', 1),
    angle: 0,
  }
}

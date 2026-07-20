import type { DoorNode, FloorplanGeometry, WallNode, WindowNode } from '@pascal-app/core'
import { type ConstructionLinearUnit, formatConstructionLength } from './construction-length'

const ANNOTATION_OFFSET = 0.34

export function buildOpeningSizeAnnotation(
  opening: DoorNode | WindowNode,
  wall: WallNode,
  {
    unit,
    preferredSide = -1,
    fill = '#334155',
  }: {
    unit: ConstructionLinearUnit
    preferredSide?: -1 | 1
    fill?: string
  },
): FloorplanGeometry | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < 1e-6) return null

  const dirX = dx / wallLength
  const dirZ = dz / wallLength
  const normalX = -dirZ
  const normalZ = dirX
  const side =
    wall.frontSide === 'exterior' && wall.backSide !== 'exterior'
      ? -1
      : wall.backSide === 'exterior' && wall.frontSide !== 'exterior'
        ? 1
        : preferredSide
  const centerX = wall.start[0] + dirX * opening.position[0]
  const centerZ = wall.start[1] + dirZ * opening.position[0]
  const offset = (wall.thickness ?? 0.1) / 2 + ANNOTATION_OFFSET
  const prefix = opening.type === 'door' ? 'D' : 'W'

  return {
    kind: 'text',
    x: centerX + normalX * offset * side,
    y: centerZ + normalZ * offset * side,
    text: `${prefix} ${formatConstructionLength(opening.width, unit)} x ${formatConstructionLength(opening.height, unit)}`,
    fontSize: 0.13,
    fill,
    fontWeight: 600,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    textAnchor: 'middle',
    dominantBaseline: 'middle',
    stroke: '#ffffff',
    strokeWidth: 0.04,
    paintOrder: 'stroke',
    upright: true,
  }
}

import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  LeanToExtensionNode,
  WallNode,
} from '@pascal-app/core'
import { resolveLeanToLayout } from './layout'

export function buildLeanToExtensionFloorplan(
  node: LeanToExtensionNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (wall?.type !== 'wall') return null
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX
  const outwardSign = Math.cos(node.rotation[1]) >= 0 ? 1 : -1
  const originX = wall.start[0] + dirX * node.position[0] + perpX * node.position[2]
  const originZ = wall.start[1] + dirZ * node.position[0] + perpZ * node.position[2]
  const layout = resolveLeanToLayout(node)
  const outX = perpX * outwardSign
  const outZ = perpZ * outwardSign
  const halfSpan = layout.span / 2 + node.sideOverhang
  const run = layout.roofRun
  const points: readonly FloorplanPoint[] = [
    [originX - dirX * halfSpan, originZ - dirZ * halfSpan],
    [originX + dirX * halfSpan, originZ + dirZ * halfSpan],
    [originX + dirX * halfSpan + outX * run, originZ + dirZ * halfSpan + outZ * run],
    [originX - dirX * halfSpan + outX * run, originZ - dirZ * halfSpan + outZ * run],
  ]
  const beamX = originX + outX * layout.projection
  const beamZ = originZ + outZ * layout.projection
  const selected = ctx.viewState?.selected ?? false
  const stroke = selected ? '#f97316' : '#475569'
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill: selected ? '#ffedd5' : '#e2e8f0',
      fillOpacity: 0.65,
      stroke,
      strokeWidth: selected ? 2 : 1.25,
      vectorEffect: 'non-scaling-stroke',
    },
    {
      kind: 'line',
      x1: beamX - (dirX * layout.span) / 2,
      y1: beamZ - (dirZ * layout.span) / 2,
      x2: beamX + (dirX * layout.span) / 2,
      y2: beamZ + (dirZ * layout.span) / 2,
      stroke,
      strokeWidth: selected ? 3 : 2,
      vectorEffect: 'non-scaling-stroke',
    },
  ]

  for (const x of layout.postXs) {
    const postX = originX + dirX * x + outX * layout.projection
    const postZ = originZ + dirZ * x + outZ * layout.projection
    children.push({
      kind: 'rect',
      x: postX - node.postWidth / 2,
      y: postZ - node.postDepth / 2,
      width: node.postWidth,
      height: node.postDepth,
      fill: stroke,
      stroke,
      strokeWidth: 1,
      vectorEffect: 'non-scaling-stroke',
    })
  }

  if (selected) {
    const arrowOffset = 0.12
    const eaveX = originX + outX * (layout.roofRun + arrowOffset)
    const eaveZ = originZ + outZ * (layout.roofRun + arrowOffset)
    children.push({
      kind: 'move-arrow',
      point: [eaveX, eaveZ],
      angle: Math.atan2(outZ, outX),
      affordance: 'lean-to-resize',
      payload: { dimension: 'projection' },
    })
    for (const side of [-1, 1] as const) {
      const x = side * (layout.span / 2 + node.sideOverhang + arrowOffset)
      children.push({
        kind: 'move-arrow',
        point: [
          originX + dirX * x + outX * layout.projection,
          originZ + dirZ * x + outZ * layout.projection,
        ],
        angle: Math.atan2(dirZ * side, dirX * side),
        affordance: 'lean-to-resize',
        payload: { dimension: 'span', side },
      })
    }
  }

  return { kind: 'group', children }
}

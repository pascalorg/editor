import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  type LeanToExtensionNode,
  type WallNode,
} from '@pascal-app/core'
import { bendLocalPoint, isCurvedLeanTo } from './arc'
import { leanToFacetCount } from './geometry'
import { resolveLeanToLayout } from './layout'

export function buildLeanToExtensionFloorplan(
  node: LeanToExtensionNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (wall?.type !== 'wall') return null

  const outwardSign = Math.cos(node.rotation[1]) >= 0 ? 1 : -1
  const layout = resolveLeanToLayout(node)
  const curved = isCurvedLeanTo(node) && isCurvedWall(wall)

  // Rigid placement basis: the node's origin on the wall plus the along
  // (tangent) and outward (normal) axes. The straight case reads the wall
  // chord; the curved case reads the wall arc frame at the node's
  // along-wall position. Local geometry is then bent in local space and
  // mapped through this single pose — mirroring the 3D group transform.
  let originX: number
  let originZ: number
  let alongX: number
  let alongZ: number
  let perpX: number
  let perpZ: number
  if (curved) {
    const arcLength = getWallCurveLength(wall)
    if (arcLength <= 1e-6) return null
    const t = Math.max(0, Math.min(1, node.position[0] / arcLength))
    const frame = getWallCurveFrameAt(wall, t)
    alongX = frame.tangent.x
    alongZ = frame.tangent.y
    perpX = frame.normal.x
    perpZ = frame.normal.y
    originX = frame.point.x + perpX * node.position[2]
    originZ = frame.point.y + perpZ * node.position[2]
  } else {
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) return null
    alongX = dx / length
    alongZ = dz / length
    perpX = -alongZ
    perpZ = alongX
    originX = wall.start[0] + alongX * node.position[0] + perpX * node.position[2]
    originZ = wall.start[1] + alongZ * node.position[0] + perpZ * node.position[2]
  }
  const localAlongX = alongX * outwardSign
  const localAlongZ = alongZ * outwardSign
  const outX = perpX * outwardSign
  const outZ = perpZ * outwardSign

  const toWorld = (localX: number, localZ: number): FloorplanPoint => {
    if (curved) {
      const bent = bendLocalPoint(node, localX, localZ)
      return [
        originX + localAlongX * bent.x + outX * bent.y,
        originZ + localAlongZ * bent.x + outZ * bent.y,
      ]
    }
    return [
      originX + localAlongX * localX + outX * localZ,
      originZ + localAlongZ * localX + outZ * localZ,
    ]
  }

  const left = layout.span / 2 + node.leftOverhang
  const right = layout.span / 2 + node.rightOverhang
  const high = node.highOverhang
  const low = layout.projection + node.lowOverhang

  const facets = curved ? leanToFacetCount(node) : 1
  const highEdge: FloorplanPoint[] = []
  const lowEdge: FloorplanPoint[] = []
  for (let i = 0; i <= facets; i++) {
    const localX = -left + ((right + left) * i) / facets
    highEdge.push(toWorld(localX, -high))
    lowEdge.push(toWorld(localX, low))
  }
  const points: readonly FloorplanPoint[] = [...highEdge, ...lowEdge.reverse()]

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
  ]

  const beamPoints: FloorplanPoint[] = []
  for (let i = 0; i <= facets; i++) {
    const localX = -layout.span / 2 + (layout.span * i) / facets
    beamPoints.push(toWorld(localX, layout.beamZ))
  }
  children.push({
    kind: 'polyline',
    points: beamPoints,
    stroke,
    strokeWidth: selected ? 3 : 2,
    vectorEffect: 'non-scaling-stroke',
  })

  for (const x of layout.postXs) {
    const [postX, postZ] = toWorld(x, layout.beamZ)
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
    const [eaveX, eaveZ] = toWorld(0, layout.roofRun + arrowOffset)
    children.push({
      kind: 'move-arrow',
      point: [eaveX, eaveZ],
      angle: Math.atan2(outZ, outX),
      affordance: 'lean-to-resize',
      payload: { dimension: 'projection' },
    })
    for (const side of [-1, 1] as const) {
      const x =
        side < 0
          ? -(layout.span / 2 + node.leftOverhang + arrowOffset)
          : layout.span / 2 + node.rightOverhang + arrowOffset
      const point = toWorld(x, layout.beamZ)
      // Local tangent at the arrow, mapped to world, so the span arrow
      // points along the (possibly bent) eave rather than the chord.
      const ahead = toWorld(x + side * 0.01, layout.beamZ)
      children.push({
        kind: 'move-arrow',
        point,
        angle: Math.atan2(ahead[1] - point[1], ahead[0] - point[0]),
        affordance: 'lean-to-resize',
        payload: { dimension: 'span', side },
      })
    }
  }

  return { kind: 'group', children }
}

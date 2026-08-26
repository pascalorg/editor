import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  type LeanToExtensionNode,
  type RoofNode,
  type RoofSegmentNode,
  type WallNode,
} from '@pascal-app/core'
import { bendLocalPoint, isCurvedLeanTo } from './arc'
import { resolveFreestandingCanopyJoints } from './canopy-joint'
import { leanToFacetCount } from './geometry'
import { isDualSlopeLeanToCanopy, resolveLeanToLayout } from './layout'
import { isLeanToPostOmitted } from './post-omissions'

function conicalSegmentPlanPose(
  segment: RoofSegmentNode,
  ctx: GeometryContext,
): { center: FloorplanPoint; rotationY: number } {
  const chain: (RoofNode | RoofSegmentNode)[] = [segment]
  let parentId = segment.parentId
  while (parentId) {
    const parent = ctx.resolve(parentId as AnyNodeId)
    if (parent?.type !== 'roof' && parent?.type !== 'roof-segment') break
    chain.push(parent)
    parentId = parent.parentId
  }

  let x = 0
  let z = 0
  let rotationY = 0
  for (const node of chain.reverse()) {
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)
    x += node.position[0] * cos + node.position[2] * sin
    z += -node.position[0] * sin + node.position[2] * cos
    rotationY += node.rotation
  }
  return { center: [x, z], rotationY }
}

function buildConicalLeanToFloorplan(
  node: LeanToExtensionNode,
  segment: RoofSegmentNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const layout = resolveLeanToLayout(node)
  const pose = conicalSegmentPlanPose(segment, ctx)
  const rotationY = pose.rotationY + node.rotation[1]
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const toWorld = (localX: number, localZ: number): FloorplanPoint => {
    const bent = bendLocalPoint(node, localX, localZ)
    const x = node.position[0] + bent.x
    const z = node.position[2] + bent.y
    return [pose.center[0] + x * cos + z * sin, pose.center[1] - x * sin + z * cos]
  }
  const facets = leanToFacetCount(node)
  const highEdge: FloorplanPoint[] = []
  const lowEdge: FloorplanPoint[] = []
  for (let index = 0; index <= facets; index++) {
    const localX = -layout.span / 2 + (layout.span * index) / facets
    highEdge.push(toWorld(localX, -node.highOverhang))
    lowEdge.push(toWorld(localX, layout.projection + node.lowOverhang))
  }

  const selected = ctx.viewState?.selected ?? false
  const stroke = selected ? '#f97316' : '#475569'
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: [...highEdge, ...lowEdge.reverse()],
      fill: selected ? '#ffedd5' : '#e2e8f0',
      fillOpacity: 0.65,
      stroke,
      strokeWidth: selected ? 2 : 1.25,
      vectorEffect: 'non-scaling-stroke',
    },
    {
      kind: 'polyline',
      points: Array.from({ length: facets + 1 }, (_, index) => {
        const localX = -layout.span / 2 + (layout.span * index) / facets
        return toWorld(localX, layout.beamZ)
      }),
      stroke,
      strokeWidth: selected ? 3 : 2,
      vectorEffect: 'non-scaling-stroke',
    },
  ]
  for (const [index, x] of layout.postXs.entries()) {
    if (isLeanToPostOmitted(node, 'low', index)) continue
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
    const point = toWorld(0, layout.roofRun + 0.12)
    children.push({
      kind: 'move-arrow',
      point,
      angle: Math.atan2(Math.cos(rotationY), Math.sin(rotationY)),
      affordance: 'lean-to-resize',
      payload: { dimension: 'projection' },
    })
  }
  return { kind: 'group', children }
}

function buildLevelLeanToFloorplan(
  node: LeanToExtensionNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const layout = resolveLeanToLayout(node)
  const rotationY = node.rotation[1]
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const toWorld = (localX: number, localZ: number): FloorplanPoint => [
    node.position[0] + localX * cos + localZ * sin,
    node.position[2] - localX * sin + localZ * cos,
  ]
  const left = layout.span / 2 + node.leftOverhang
  const right = layout.span / 2 + node.rightOverhang
  const high = isDualSlopeLeanToCanopy(layout.canopyForm)
    ? layout.projection + node.lowOverhang
    : node.highOverhang
  const low = layout.projection + node.lowOverhang
  const canopyJoints = resolveFreestandingCanopyJoints(
    node,
    Object.fromEntries(
      [node, ...ctx.siblings].map((candidate) => [candidate.id, candidate]),
    ) as Record<string, AnyNode>,
  )
  const edgeXAtZ = (side: 'left' | 'right', z: number) => {
    const joint = canopyJoints[side]
    if (!joint) return side === 'left' ? -left : right
    const structuralX = side === 'left' ? -layout.span / 2 : layout.span / 2
    if (joint.kind === 'linear') return structuralX
    const inwardSign = side === 'left' ? 1 : -1
    const innerSideSign = joint.innerCanopySide === 'positive' ? 1 : -1
    return structuralX + inwardSign * innerSideSign * (z / joint.trimZ) * joint.trimX
  }
  const points: FloorplanPoint[] = isDualSlopeLeanToCanopy(layout.canopyForm)
    ? [
        toWorld(edgeXAtZ('left', -high), -high),
        toWorld(edgeXAtZ('right', -high), -high),
        ...(canopyJoints.right ? [toWorld(layout.span / 2, 0)] : []),
        toWorld(edgeXAtZ('right', low), low),
        toWorld(edgeXAtZ('left', low), low),
        ...(canopyJoints.left ? [toWorld(-layout.span / 2, 0)] : []),
      ]
    : [
        toWorld(edgeXAtZ('left', -high), -high),
        toWorld(edgeXAtZ('right', -high), -high),
        toWorld(edgeXAtZ('right', low), low),
        toWorld(edgeXAtZ('left', low), low),
      ]
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
      kind: 'polyline',
      points: [
        toWorld(-layout.beamSpan / 2, layout.beamZ),
        toWorld(layout.beamSpan / 2, layout.beamZ),
      ],
      stroke,
      strokeWidth: selected ? 3 : 2,
      vectorEffect: 'non-scaling-stroke',
    },
  ]
  if (isDualSlopeLeanToCanopy(layout.canopyForm)) {
    children.push({
      kind: 'polyline',
      points: [
        toWorld(-layout.beamSpan / 2, layout.oppositeBeamZ),
        toWorld(layout.beamSpan / 2, layout.oppositeBeamZ),
      ],
      stroke,
      strokeWidth: selected ? 3 : 2,
      vectorEffect: 'non-scaling-stroke',
    })
  }
  const addPostRow = (localZ: number, side: 'low' | 'high') => {
    for (const [index, x] of layout.postXs.entries()) {
      if (isLeanToPostOmitted(node, side, index)) continue
      const [postX, postZ] = toWorld(x, localZ)
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
  }
  addPostRow(layout.beamZ, 'low')
  if (node.highSideMode === 'independent-high-beam') {
    addPostRow(isDualSlopeLeanToCanopy(layout.canopyForm) ? layout.oppositeBeamZ : 0, 'high')
  }
  if (selected) {
    children.push({
      kind: 'move-arrow',
      point: toWorld(0, layout.roofRun + 0.12),
      angle: Math.atan2(Math.cos(rotationY), Math.sin(rotationY)),
      affordance: 'lean-to-resize',
      payload: { dimension: 'projection' },
    })
    if (node.hostKind === 'freestanding') {
      const point = toWorld(right + 0.25, low + 0.25)
      const center = toWorld(layout.roofCenterX, layout.roofCenterZ)
      children.push({
        kind: 'rotate-arrow',
        point,
        angle: Math.atan2(point[1] - center[1], point[0] - center[0]),
        affordance: 'lean-to-rotate',
        pivot: center,
      })
    }
  }
  return { kind: 'group', children }
}

export function buildLeanToExtensionFloorplan(
  node: LeanToExtensionNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (
    ctx.parent?.type === 'roof-segment' &&
    ctx.parent.roofType === 'conical' &&
    node.hostKind === 'conical-roof'
  ) {
    return buildConicalLeanToFloorplan(node, ctx.parent, ctx)
  }
  if (
    ctx.parent?.type === 'level' &&
    (node.hostKind === 'slab-edge' || node.hostKind === 'freestanding')
  ) {
    return buildLevelLeanToFloorplan(node, ctx)
  }
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

  for (const [index, x] of layout.postXs.entries()) {
    if (isLeanToPostOmitted(node, 'low', index)) continue
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

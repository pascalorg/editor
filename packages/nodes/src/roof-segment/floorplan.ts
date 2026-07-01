import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getDutchRoofMetrics,
  type RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for roof segment. Renders the segment as a
 * proper architectural roof plan: the footprint outline plus the
 * ridge / hip / break linework (and a downslope arrow for sheds) that
 * makes each roof shape — hip, gable, shed, gambrel, dutch, mansard,
 * flat — read distinctly, rather than as a bare rectangle.
 *
 * All linework is derived in segment-local space, mirroring the faces the
 * 3D builder (`getModuleFaces` in the roof system) generates per type, so
 * the plan and the model agree. Everything is composed into world coords
 * via the parent roof's position + rotation and the segment's own.
 */
export function buildRoofSegmentFloorplan(
  node: RoofSegmentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const roof = ctx.parent as RoofNode | null
  if (roof?.type !== 'roof') return null

  // Segment center in world coords. Floor-plan plots at `-rotation` so
  // SVG's CW-with-y-down `rotate` direction ends up matching Three.js
  // Y-rotation (CCW from top-down). The standard math rotation matrix
  // applied to (localX, localZ) with `+rotation` gives screen-CW in
  // SVG; negating the rotation gives screen-CCW = matches Three.js.
  const planRoofRotation = -roof.rotation
  const cosRoof = Math.cos(planRoofRotation)
  const sinRoof = Math.sin(planRoofRotation)
  const localX = node.position[0]
  const localZ = node.position[2]
  const cx = roof.position[0] + localX * cosRoof - localZ * sinRoof
  const cz = roof.position[2] + localX * sinRoof + localZ * cosRoof

  const rotation = -(roof.rotation + node.rotation)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const halfWidth = node.width / 2
  const halfDepth = node.depth / 2

  // Map a segment-local point (lx = width axis, lz = depth axis) into
  // world plan coords — the same rotation + translation the footprint
  // corners use. Shared by the per-type ridge/hip linework below.
  const toPlan = (lx: number, lz: number): FloorplanPoint => [
    cx + lx * cos - lz * sin,
    cz + lx * sin + lz * cos,
  ]

  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]
  const points: FloorplanPoint[] = corners.map(([x, y]) => toPlan(x, y))

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Black architectural outline by default; palette accent on select.
  // Mirrors the elevator / column style so all structural elements read
  // the same in the floor plan.
  const baseInk = '#111111'
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : baseInk

  const children: FloorplanGeometry[] = [
    // Invisible hit-target — full footprint, transparent fill, captures
    // clicks across the entire roof rectangle (so the user doesn't need
    // to pixel-hunt the outline strokes).
    {
      kind: 'polygon',
      points,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    },
  ]

  // The segment's own rectangle outline + fill render ONLY while it's
  // selected / highlighted — that highlights which sub-plane is active
  // (including its interior edges shared with neighbours). When unselected
  // the eaves come from the parent roof's merged outline
  // (`buildRoofFloorplan`), so overlapping segments read as one combined
  // shape instead of stacked rectangles. Ridges/hips below always draw.
  if (showSelectedChrome) {
    children.push({
      kind: 'polygon',
      points,
      fill: '#fed7aa',
      fillOpacity: 0.55,
      stroke,
      strokeWidth: 0.035,
      strokeLinejoin: 'miter',
    })
  }

  // NOTE: the ridge / hip / break / slope linework is NOT drawn here — the
  // parent roof's builder (`buildRoofFloorplan`) draws it for every segment,
  // clipped against the merged-roof valleys so a segment's ridge stops at
  // the junction instead of running on into a neighbour it overlaps. This
  // builder owns only the per-segment interaction chrome below. The shape
  // math lives in `getRoofSegmentPlanLinework` (exported for the roof
  // builder to consume).

  // Selection chrome — orange move-handle dot at the centre, four
  // perpendicular side resize-arrows (width on X, depth on Z), and a
  // rotate-arrow at the +X/+Z corner. Sister to the 3D handles in
  // `definition.ts`. Resize/rotate route through the matching
  // `floorplanAffordances`; the dot drives body-move via
  // `def.floorplanMoveTarget`.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [cx, cz],
    })

    const sideArrowOffset = 0.12
    const rotateCornerOffset = 0.22
    const halfW = node.width / 2
    const halfD = node.depth / 2
    // Effective rotation = parent roof rotation + segment-local rotation.
    // Reuse `cos` / `sin` from the corner computation above (they were
    // computed for the same `rotation` value).
    const rotateLocal = (lx: number, ly: number): [number, number] => [
      lx * cos - ly * sin,
      lx * sin + ly * cos,
    ]
    const sides: Array<{
      local: [number, number]
      localAngle: number
      axis: 'x' | 'z'
      side: 1 | -1
    }> = [
      { local: [halfW + sideArrowOffset, 0], localAngle: 0, axis: 'x', side: 1 },
      { local: [-(halfW + sideArrowOffset), 0], localAngle: Math.PI, axis: 'x', side: -1 },
      { local: [0, halfD + sideArrowOffset], localAngle: Math.PI / 2, axis: 'z', side: 1 },
      { local: [0, -(halfD + sideArrowOffset)], localAngle: -Math.PI / 2, axis: 'z', side: -1 },
    ]
    for (const s of sides) {
      const [ox, oz] = rotateLocal(s.local[0], s.local[1])
      const [tx, tz] = rotateLocal(Math.cos(s.localAngle), Math.sin(s.localAngle))
      children.push({
        kind: 'move-arrow',
        point: [cx + ox, cz + oz],
        angle: Math.atan2(tz, tx),
        affordance: 'roof-segment-resize',
        payload: { axis: s.axis, side: s.side },
      })
    }

    // Rotate-arrow at the +X / +Z corner. Local angle π/4 puts the
    // curved arrow's bow at the diagonal corner so it reads as a
    // rotation gizmo around the segment centre.
    const [cornerX, cornerZ] = rotateLocal(halfW + rotateCornerOffset, halfD + rotateCornerOffset)
    const [radialX, radialZ] = rotateLocal(1, 1)
    children.push({
      kind: 'rotate-arrow',
      point: [cx + cornerX, cz + cornerZ],
      angle: Math.atan2(radialZ, radialX),
      affordance: 'roof-segment-rotate',
      pivot: [cx, cz],
    })
  }

  return { kind: 'group', children }
}

export type PlanPt = readonly [number, number]
export type PlanSeg = readonly [PlanPt, PlanPt]

/**
 * Ridge / hip / break linework for a roof segment in segment-local space
 * (lx = width axis, lz = depth axis), mirroring the faces the 3D builder
 * (`getModuleFaces`) generates for each roof type. The floor-plan builder
 * maps these to world coords. `slope`, when set, is a shed roof's downhill
 * fall direction (tail = high eave, head = low eave).
 *
 * - ridge: peak line(s) where opposite slopes meet
 * - hip:   diagonal from an eave corner up to a ridge end / peak
 * - break: horizontal fold where the slope angle changes (gambrel kink,
 *          mansard/dutch waist)
 *
 * Exported so the roof-level builder can reuse it to terminate the valley
 * diagonals it draws at merged-roof junctions against the segments' ridges.
 */
export function getRoofSegmentPlanLinework(node: RoofSegmentNode): {
  ridges: PlanSeg[]
  hips: PlanSeg[]
  breaks: PlanSeg[]
  slope: { tail: PlanPt; head: PlanPt } | null
} {
  const hw = node.width / 2
  const hd = node.depth / 2
  const ridges: PlanSeg[] = []
  const hips: PlanSeg[] = []
  const breaks: PlanSeg[] = []
  let slope: { tail: PlanPt; head: PlanPt } | null = null

  // Eave corners, matching e1..e4 in the 3D `getModuleFaces` builder.
  const e1: PlanPt = [-hw, hd]
  const e2: PlanPt = [hw, hd]
  const e3: PlanPt = [hw, -hd]
  const e4: PlanPt = [-hw, -hd]

  // Hip linework shared by `hip` and the collapsed-waist mansard/dutch
  // fallbacks: ridge along the longer axis, four hips from the eave
  // corners to the nearer ridge end — or a single peak when square.
  const pushHip = () => {
    if (Math.abs(node.width - node.depth) < 0.01) {
      const peak: PlanPt = [0, 0]
      hips.push([e1, peak], [e2, peak], [e3, peak], [e4, peak])
    } else if (node.width >= node.depth) {
      const r1: PlanPt = [-hw + hd, 0]
      const r2: PlanPt = [hw - hd, 0]
      ridges.push([r1, r2])
      hips.push([e1, r1], [e4, r1], [e2, r2], [e3, r2])
    } else {
      const r1: PlanPt = [0, hd - hw]
      const r2: PlanPt = [0, -hd + hw]
      ridges.push([r1, r2])
      hips.push([e1, r1], [e2, r1], [e3, r2], [e4, r2])
    }
  }

  switch (node.roofType) {
    case 'flat':
      break
    case 'gable':
      // Single ridge down the middle along the width axis.
      ridges.push([
        [-hw, 0],
        [hw, 0],
      ])
      break
    case 'shed':
      // 3D builder slopes from the high eave (lz = -hd) down to lz = +hd.
      slope = { tail: [0, -hd * 0.55], head: [0, hd * 0.55] }
      break
    case 'hip':
      pushHip()
      break
    case 'gambrel': {
      // Ridge + two kink lines parallel to it.
      const mz = hd * node.gambrelLowerWidthRatio
      ridges.push([
        [-hw, 0],
        [hw, 0],
      ])
      breaks.push(
        [
          [-hw, mz],
          [hw, mz],
        ],
        [
          [-hw, -mz],
          [hw, -mz],
        ],
      )
      break
    }
    case 'mansard': {
      // Inner waist rectangle + four corner hips from the eaves to it.
      const i = Math.min(node.width, node.depth) * node.mansardSteepWidthRatio
      if (hw - i > 0.02 && hd - i > 0.02) {
        const w1: PlanPt = [-hw + i, hd - i]
        const w2: PlanPt = [hw - i, hd - i]
        const w3: PlanPt = [hw - i, -hd + i]
        const w4: PlanPt = [-hw + i, -hd + i]
        breaks.push([w1, w2], [w2, w3], [w3, w4], [w4, w1])
        hips.push([e1, w1], [e2, w2], [e3, w3], [e4, w4])
      } else {
        pushHip()
      }
      break
    }
    case 'dutch': {
      const metrics = getDutchRoofMetrics(node)
      if (!(metrics.waistHalfX > 0.02 && metrics.waistHalfZ > 0.02)) {
        pushHip()
        break
      }

      const w1: PlanPt = [-metrics.waistHalfX, metrics.waistHalfZ]
      const w2: PlanPt = [metrics.waistHalfX, metrics.waistHalfZ]
      const w3: PlanPt = [metrics.waistHalfX, -metrics.waistHalfZ]
      const w4: PlanPt = [-metrics.waistHalfX, -metrics.waistHalfZ]
      hips.push([e1, w1], [e2, w2], [e3, w3], [e4, w4])
      breaks.push([w1, w2], [w2, w3], [w3, w4], [w4, w1])
      ridges.push([metrics.ridgeStart, metrics.ridgeEnd])
      break
    }
  }

  return { ridges, hips, breaks, slope }
}

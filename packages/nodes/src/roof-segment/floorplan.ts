import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for roof segment. Renders the segment's
 * footprint as a rotated rectangle in world coords (parent roof's
 * position + rotation composed with the segment's own).
 *
 * Inlined from `getRoofSegmentPolygon` / `getRoofSegmentCenter` in
 * `floorplan-panel.tsx`. Ridge line not yet rendered — adds a follow-up
 * for full visual parity.
 */
export function buildRoofSegmentFloorplan(
  node: RoofSegmentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const roof = ctx.parent as RoofNode | null
  if (!roof || roof.type !== 'roof') return null

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

  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]
  const points: FloorplanPoint[] = corners.map(([x, y]) => [
    cx + x * cos - y * sin,
    cz + x * sin + y * cos,
  ])

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
    // Visible outline.
    {
      kind: 'polygon',
      points,
      fill: showSelectedChrome ? '#fed7aa' : 'none',
      fillOpacity: showSelectedChrome ? 0.55 : 0,
      stroke,
      strokeWidth: showSelectedChrome ? 0.035 : 0.025,
      strokeLinejoin: 'miter',
    },
  ]

  // Ridge line — only for pitched segments, not flat roofs. Dashed
  // black so it reads as the ridge (axis of the pitch) without
  // competing with the perimeter outline.
  if (node.roofType !== 'flat') {
    const ridgeAxis =
      node.roofType === 'gable' || node.roofType === 'gambrel'
        ? 'x'
        : node.roofType === 'dutch'
          ? node.width >= node.depth
            ? 'x'
            : 'z'
          : 'z'
    const axisAngle = ridgeAxis === 'x' ? rotation : rotation + Math.PI / 2
    const halfSpan = ridgeAxis === 'x' ? node.width / 2 : node.depth / 2
    children.push({
      kind: 'line',
      x1: cx - halfSpan * Math.cos(axisAngle),
      y1: cz - halfSpan * Math.sin(axisAngle),
      x2: cx + halfSpan * Math.cos(axisAngle),
      y2: cz + halfSpan * Math.sin(axisAngle),
      stroke,
      strokeWidth: 0.02,
      strokeDasharray: '0.1 0.08',
      strokeLinecap: 'butt',
      opacity: 0.85,
    })
  }

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
    })
  }

  return { kind: 'group', children }
}

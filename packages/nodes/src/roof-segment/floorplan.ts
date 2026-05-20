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

  // Segment center in world coords: parent roof's transform applied to
  // the segment's local position offset.
  const cosRoof = Math.cos(roof.rotation)
  const sinRoof = Math.sin(roof.rotation)
  const localX = node.position[0]
  const localZ = node.position[2]
  const cx = roof.position[0] + localX * cosRoof - localZ * sinRoof
  const cz = roof.position[2] + localX * sinRoof + localZ * cosRoof

  const rotation = roof.rotation + node.rotation
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

  const stroke =
    showSelectedChrome && palette ? palette.selectedStroke : 'rgba(125, 211, 252, 0.82)'
  const fill = showSelectedChrome ? '#fed7aa' : 'rgba(56, 189, 248, 0.16)'

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill,
      stroke,
      strokeWidth: showSelectedChrome ? 0.04 : 0.025,
      strokeLinejoin: 'round',
      opacity: 0.85,
    },
  ]

  // Ridge line — only for pitched segments, not flat roofs.
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
      stroke: showSelectedChrome ? '#eff6ff' : 'rgba(186, 230, 253, 0.84)',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  }

  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [cx, cz],
    })
  }

  return { kind: 'group', children }
}

import type {
  AnyNodeId,
  EyebrowVentNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Floor-plan builder for an eyebrow vent — seen from above it reads as the
 * lens (eye-shaped) footprint of the hood, with a faint centre seam. The
 * coordinate frame mirrors the 3D transform stack (roof → roof-segment →
 * vent), same as the box-vent / cupola builders.
 */
export function buildEyebrowVentFloorplan(
  node: EyebrowVentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const segment = ctx.parent as RoofSegmentNode | null
  if (segment?.type !== 'roof-segment') return null
  const roofId = segment.parentId as AnyNodeId | null
  const roof = roofId ? (ctx.resolve(roofId) as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  const cosR = Math.cos(-roof.rotation)
  const sinR = Math.sin(-roof.rotation)
  const segCx = roof.position[0] + segment.position[0] * cosR - segment.position[2] * sinR
  const segCz = roof.position[2] + segment.position[0] * sinR + segment.position[2] * cosR

  const segRot = -(roof.rotation + segment.rotation)
  const cosS = Math.cos(segRot)
  const sinS = Math.sin(segRot)
  const cx = segCx + node.position[0] * cosS - node.position[2] * sinS
  const cz = segCz + node.position[0] * sinS + node.position[2] * cosS

  const rot = -(roof.rotation + segment.rotation + node.rotation)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const toPlan = (lx: number, lz: number): FloorplanPoint => [
    cx + lx * cos - lz * sin,
    cz + lx * sin + lz * cos,
  ]

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const baseInk = '#475569'
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : baseInk
  const fill = showSelectedChrome ? '#fed7aa' : '#dbe1e8'
  const fillOpacity = showSelectedChrome ? 0.55 : 0.7
  const lineWidth = showSelectedChrome ? 0.03 : 0.02

  const hw = Math.max(node.width, 0.1) / 2
  const hd = Math.max(node.depth, 0.1) / 2

  const rect = (halfX: number, halfZ: number): FloorplanPoint[] => [
    toPlan(-halfX, -halfZ),
    toPlan(halfX, -halfZ),
    toPlan(halfX, halfZ),
    toPlan(-halfX, halfZ),
  ]

  const children: FloorplanGeometry[] = []

  // Hood footprint outline + hit target (no flashing plate).
  const hood = rect(hw, hd)
  children.push({
    kind: 'polygon',
    points: hood,
    fill: stroke,
    fillOpacity: 0,
    stroke: 'none',
    strokeWidth: 0,
    pointerEvents: 'all',
  })
  children.push({
    kind: 'polygon',
    points: hood,
    fill,
    fillOpacity,
    stroke,
    strokeWidth: lineWidth,
    strokeLinejoin: 'round',
    pointerEvents: 'none',
  })
  // Front edge (the louvered opening faces +Z).
  children.push({
    kind: 'polyline',
    points: [toPlan(-hw, hd), toPlan(hw, hd)],
    stroke,
    strokeWidth: lineWidth,
    strokeOpacity: 0.9,
    pointerEvents: 'none',
  })

  return { kind: 'group', children }
}

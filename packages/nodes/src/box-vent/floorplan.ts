import type {
  AnyNodeId,
  BoxVentNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Floor-plan builder for a box vent — a small attic-exhaust vent on a roof
 * slope. Seen from above it reads as its footprint per style: `box` is a
 * cover with an inset riser, `cap` flares to a flange past the body, and
 * `dome` is a flush ellipse.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → vent), same as the chimney builder. `position`
 * is segment-local (X = width, Z = depth; Y ignored — anchored to the
 * slope). `rotation` is yaw. Rotations negated for the floor plan's y-down
 * convention.
 */
export function buildBoxVentFloorplan(
  node: BoxVentNode,
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

  // Painted-metal vent — cool grey, accent on select, light blue on hover.
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

  const hw = Math.max(node.width, 0.05) / 2
  const hd = Math.max(node.depth, 0.05) / 2
  const style = node.style ?? 'cap'

  const rect = (halfX: number, halfZ: number): FloorplanPoint[] => [
    toPlan(-halfX, -halfZ),
    toPlan(halfX, -halfZ),
    toPlan(halfX, halfZ),
    toPlan(-halfX, halfZ),
  ]
  const ellipse = (halfX: number, halfZ: number): FloorplanPoint[] => {
    const pts: FloorplanPoint[] = []
    const N = 28
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      pts.push(toPlan(halfX * Math.cos(a), halfZ * Math.sin(a)))
    }
    return pts
  }

  const children: FloorplanGeometry[] = []

  if (style === 'dome') {
    // Outer = the round flange plate (dome radius + flange overhang).
    const ovh = Math.max(0, node.hoodOverhang ?? 0.04)
    const outer = ellipse(hw + ovh, hd + ovh)
    children.push({
      kind: 'polygon',
      points: outer,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    })
    children.push({
      kind: 'polygon',
      points: outer,
      fill,
      fillOpacity,
      stroke,
      strokeWidth: lineWidth,
      pointerEvents: 'none',
    })
    // Dome footprint inside the flange.
    children.push({
      kind: 'polygon',
      points: ellipse(hw, hd),
      fill: 'none',
      stroke,
      strokeWidth: lineWidth * 0.8,
      strokeOpacity: 0.7,
      pointerEvents: 'none',
    })
    // Inner ring suggests the dome bulge.
    children.push({
      kind: 'polygon',
      points: ellipse(hw * 0.5, hd * 0.5),
      fill: 'none',
      stroke,
      strokeWidth: lineWidth * 0.8,
      strokeOpacity: 0.5,
      pointerEvents: 'none',
    })
  } else if (style === 'cap') {
    // Flange flares past the body by `hoodOverhang` on all sides.
    const ovh = Math.max(0, node.hoodOverhang ?? 0.04)
    const outer = rect(hw + ovh, hd + ovh)
    children.push({
      kind: 'polygon',
      points: outer,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    })
    children.push({
      kind: 'polygon',
      points: outer,
      fill,
      fillOpacity,
      stroke,
      strokeWidth: lineWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
    // Body footprint inside the flange.
    children.push({
      kind: 'polygon',
      points: rect(hw, hd),
      fill: 'none',
      stroke,
      strokeWidth: lineWidth * 0.8,
      strokeOpacity: 0.7,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
  } else {
    // box: cover footprint + inset riser.
    const outer = rect(hw, hd)
    children.push({
      kind: 'polygon',
      points: outer,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    })
    children.push({
      kind: 'polygon',
      points: outer,
      fill,
      fillOpacity,
      stroke,
      strokeWidth: lineWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
    const inset = Math.max(0, Math.min(node.baseInset ?? 0.06, Math.min(hw, hd) - 0.01))
    if (inset > 0.001) {
      children.push({
        kind: 'polygon',
        points: rect(hw - inset, hd - inset),
        fill: 'none',
        stroke,
        strokeWidth: lineWidth * 0.8,
        strokeOpacity: 0.7,
        strokeLinejoin: 'miter',
        pointerEvents: 'none',
      })
    }
  }

  return { kind: 'group', children }
}

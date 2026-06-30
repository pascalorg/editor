import type {
  AnyNodeId,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
} from '@pascal-app/core'

/**
 * Floor-plan builder for a skylight — a glazed opening set into the roof
 * slope. Seen from above it's the classic skylight symbol: an outer frame
 * rectangle, an inset glass pane, and a diagonal cross over the glass.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → skylight), same as the chimney builder.
 * `position` is segment-local (X = width across slope, Z = height down
 * slope; Y ignored — anchored to the slope). `rotation` is yaw. Rotations
 * negated for the floor plan's y-down convention. The frame extends
 * outward by `frameThickness` past the `width × height` glass opening
 * (matching `frame-csg.ts`).
 */
export function buildSkylightFloorplan(
  node: SkylightNode,
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
  const frameFill = showSelectedChrome ? '#fed7aa' : '#e2e8f0'
  const glassFill = showSelectedChrome ? '#fed7aa' : '#dbeafe'
  const frameFillOpacity = showSelectedChrome ? 0.55 : 0.7
  const glassFillOpacity = showSelectedChrome ? 0.45 : 0.55
  const lineWidth = showSelectedChrome ? 0.03 : 0.02

  const hw = Math.max(node.width, 0.1) / 2
  const hh = Math.max(node.height, 0.1) / 2
  const ft = Math.max(0, node.frameThickness ?? 0.05)
  const outerHX = hw + ft
  const outerHZ = hh + ft

  const rect = (halfX: number, halfZ: number): FloorplanPoint[] => [
    toPlan(-halfX, -halfZ),
    toPlan(halfX, -halfZ),
    toPlan(halfX, halfZ),
    toPlan(-halfX, halfZ),
  ]

  const children: FloorplanGeometry[] = [
    // Transparent hit-target over the outer frame.
    {
      kind: 'polygon',
      points: rect(outerHX, outerHZ),
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    },
    // Outer frame / curb.
    {
      kind: 'polygon',
      points: rect(outerHX, outerHZ),
      fill: frameFill,
      fillOpacity: frameFillOpacity,
      stroke,
      strokeWidth: lineWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    },
    // Inset glass pane.
    {
      kind: 'polygon',
      points: rect(hw, hh),
      fill: glassFill,
      fillOpacity: glassFillOpacity,
      stroke,
      strokeWidth: lineWidth * 0.8,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    },
  ]

  // Diagonal glazing cross over the pane — the standard skylight symbol.
  const tl = toPlan(-hw, -hh)
  const tr = toPlan(hw, -hh)
  const bl = toPlan(-hw, hh)
  const br = toPlan(hw, hh)
  children.push(
    {
      kind: 'line',
      x1: tl[0],
      y1: tl[1],
      x2: br[0],
      y2: br[1],
      stroke,
      strokeWidth: lineWidth * 0.7,
      strokeOpacity: 0.7,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    },
    {
      kind: 'line',
      x1: tr[0],
      y1: tr[1],
      x2: bl[0],
      y2: bl[1],
      stroke,
      strokeWidth: lineWidth * 0.7,
      strokeOpacity: 0.7,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    },
  )

  return { kind: 'group', children }
}

import type {
  AnyNodeId,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
  TurbineVentNode,
} from '@pascal-app/core'

/**
 * Floor-plan builder for a turbine vent — seen from above it reads as the
 * round flange flashing with the head circle inside and short radial ticks
 * suggesting the vanes.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → vent), same as the box-vent builder. `position`
 * is segment-local; `rotation` is yaw; rotations are negated for the floor
 * plan's y-down convention.
 */
export function buildTurbineVentFloorplan(
  node: TurbineVentNode,
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

  const ro = Math.max(node.diameter, 0.05) / 2
  const flangeR = ro + Math.max(0, node.baseOverhang ?? 0.05)

  const circle = (r: number): FloorplanPoint[] => {
    const pts: FloorplanPoint[] = []
    const N = 32
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      pts.push(toPlan(r * Math.cos(a), r * Math.sin(a)))
    }
    return pts
  }

  const children: FloorplanGeometry[] = []

  // Flange footprint — the hit target + outer ring.
  const outer = circle(flangeR)
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

  // Head circle.
  children.push({
    kind: 'polygon',
    points: circle(ro),
    fill: 'none',
    stroke,
    strokeWidth: lineWidth * 0.8,
    strokeOpacity: 0.7,
    pointerEvents: 'none',
  })

  // Radial vane ticks from the hub out to the head circle.
  const vanes = Math.max(6, Math.min(36, Math.round(node.vaneCount ?? 20)))
  const hubR = ro * 0.4
  for (let i = 0; i < vanes; i++) {
    const a = (i / vanes) * Math.PI * 2
    children.push({
      kind: 'polyline',
      points: [
        toPlan(hubR * Math.cos(a), hubR * Math.sin(a)),
        toPlan(ro * Math.cos(a), ro * Math.sin(a)),
      ],
      stroke,
      strokeWidth: lineWidth * 0.6,
      strokeOpacity: 0.5,
      pointerEvents: 'none',
    })
  }

  return { kind: 'group', children }
}

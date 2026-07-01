import type {
  AnyNodeId,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RidgeVentNode,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'

// Tab pitch for the shingled style — matches SHINGLED_TAB_SIZE in
// geometry.ts so the plan's divider spacing reads like the 3D ridge cap.
const SHINGLED_TAB_SIZE = 0.3

/**
 * Floor-plan builder for a ridge vent — a ventilation strip running along
 * a roof ridge. Seen from above it's a long thin band straddling the
 * ridge crest, with a centre crest line, end caps where closed, and tab
 * dividers for the shingled style.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → vent), same as the chimney builder. `position`
 * is segment-local; the run (`length`) is along local +X and the small
 * cross-`width` straddles the ridge along local Z (centred at Z = 0).
 * `rotation` is yaw, negated for the floor plan's y-down convention.
 */
export function buildRidgeVentFloorplan(
  node: RidgeVentNode,
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
  const fillOpacity = showSelectedChrome ? 0.55 : 0.6
  const lineWidth = showSelectedChrome ? 0.03 : 0.02

  const halfLen = Math.max(node.length, 0.1) / 2
  const halfW = Math.max(node.width, 0.04) / 2

  const corners: FloorplanPoint[] = [
    toPlan(-halfLen, -halfW),
    toPlan(halfLen, -halfW),
    toPlan(halfLen, halfW),
    toPlan(-halfLen, halfW),
  ]

  const children: FloorplanGeometry[] = [
    // Transparent hit-target over the whole strip.
    {
      kind: 'polygon',
      points: corners,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    },
    // Strip fill.
    {
      kind: 'polygon',
      points: corners,
      fill,
      fillOpacity,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'none',
    },
  ]

  const seg = (
    a: readonly [number, number],
    b: readonly [number, number],
    w: number,
    opacity?: number,
  ) => {
    const pa = toPlan(a[0], a[1])
    const pb = toPlan(b[0], b[1])
    children.push({
      kind: 'line',
      x1: pa[0],
      y1: pa[1],
      x2: pb[0],
      y2: pb[1],
      stroke,
      strokeWidth: w,
      strokeLinecap: 'round',
      opacity,
      pointerEvents: 'none',
    })
  }

  // Long edges along the run (always) + end caps (only when closed).
  seg([-halfLen, -halfW], [halfLen, -halfW], lineWidth)
  seg([-halfLen, halfW], [halfLen, halfW], lineWidth)
  if (node.endCaps !== false) {
    seg([-halfLen, -halfW], [-halfLen, halfW], lineWidth)
    seg([halfLen, -halfW], [halfLen, halfW], lineWidth)
  }

  // Ridge crest line down the centre.
  seg([-halfLen, 0], [halfLen, 0], lineWidth * 0.8, 0.7)

  // Shingled style: tab dividers across the width at the cap pitch.
  if (node.style === 'shingled') {
    const total = halfLen * 2
    const count = Math.max(2, Math.round(total / SHINGLED_TAB_SIZE))
    const step = total / count
    for (let i = 1; i < count; i++) {
      const x = -halfLen + i * step
      seg([x, -halfW], [x, halfW], lineWidth * 0.6, 0.5)
    }
  }

  return { kind: 'group', children }
}

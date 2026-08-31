import type {
  AnyNodeId,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
  SolarPanelNode,
} from '@pascal-app/core'

/**
 * Floor-plan builder for a solar-panel array — a grid of photovoltaic
 * modules mounted on a roof segment. Seen from above it reads as its
 * `rows × columns` grid of dark module rectangles with gaps between them.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → panel), same as the chimney builder. The array's
 * `position` is segment-local (X = width axis, Z = depth axis; Y is
 * ignored — the 3D renderer anchors it to the slope). `rotation` is yaw.
 * Rotations are negated for the floor plan's y-down convention (see
 * `buildRoofSegmentFloorplan`).
 *
 * The per-module layout matches `buildSolarPanelGeometry` exactly: the
 * array is centred at the origin, modules step by `panel + gap` along each
 * axis (columns along X, rows along Z). A tilted array foreshortens
 * slightly in 3D, but the plan shows its full mounting footprint — that's
 * what matters for roof layout.
 */
export function buildSolarPanelFloorplan(
  node: SolarPanelNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const segment = ctx.parent as RoofSegmentNode | null
  if (segment?.type !== 'roof-segment') return null
  const roofId = segment.parentId as AnyNodeId | null
  const roof = roofId ? (ctx.resolve(roofId) as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  // Compose roof → segment → panel in plan coords. Each rotation is
  // negated so SVG's y-down CW matches Three.js' top-down CCW.
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

  // Photovoltaic modules — dark glass with a thin frame. Accent on select,
  // light blue on hover.
  const baseInk = '#1e293b'
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : baseInk
  const moduleFill = showSelectedChrome ? '#fed7aa' : '#334155'
  const moduleFillOpacity = showSelectedChrome ? 0.5 : 0.85
  const lineWidth = showSelectedChrome ? 0.028 : 0.016

  // Grid params — guarded + clamped to the schema's ranges so a malformed
  // or un-migrated node can't NaN the layout or blow up the module loop.
  const rows = Math.max(1, Math.min(20, Math.floor(node.rows ?? 1)))
  const columns = Math.max(1, Math.min(20, Math.floor(node.columns ?? 1)))
  const panelW = Math.max(0.05, node.panelWidth ?? 1)
  const panelH = Math.max(0.05, node.panelHeight ?? 1)
  const gapX = Math.max(0, node.gapX ?? 0)
  const gapY = Math.max(0, node.gapY ?? 0)

  const totalW = columns * panelW + (columns - 1) * gapX
  const totalH = rows * panelH + (rows - 1) * gapY
  const originX = -totalW / 2
  const originZ = -totalH / 2
  const halfW = totalW / 2
  const halfH = totalH / 2

  const children: FloorplanGeometry[] = [
    // One transparent hit-target across the whole array so clicking a gap
    // (or any module) selects the array.
    {
      kind: 'polygon',
      points: [
        toPlan(-halfW, -halfH),
        toPlan(halfW, -halfH),
        toPlan(halfW, halfH),
        toPlan(-halfW, halfH),
      ],
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    },
  ]

  // One filled rectangle per module — same loop as `buildSolarPanelGeometry`
  // (columns along X, rows along Z), so the plan grid matches the 3D array.
  const hw = panelW / 2
  const hh = panelH / 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const mcx = originX + c * (panelW + gapX) + panelW / 2
      const mcz = originZ + r * (panelH + gapY) + panelH / 2
      children.push({
        kind: 'polygon',
        points: [
          toPlan(mcx - hw, mcz - hh),
          toPlan(mcx + hw, mcz - hh),
          toPlan(mcx + hw, mcz + hh),
          toPlan(mcx - hw, mcz + hh),
        ],
        fill: moduleFill,
        fillOpacity: moduleFillOpacity,
        stroke,
        strokeWidth: lineWidth,
        strokeLinejoin: 'miter',
        pointerEvents: 'none',
      })
    }
  }

  return { kind: 'group', children }
}

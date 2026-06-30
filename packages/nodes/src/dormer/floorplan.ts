import type {
  AnyNodeId,
  DormerNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Floor-plan builder for a dormer — a small house-shaped structure that
 * projects from a roof slope, with its own little roof and a window on the
 * front face. Seen from above it reads as a `width × depth` footprint plus
 * its roof's ridge/hip linework, and a line marking the window on the
 * down-slope (+Z) front face.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → dormer), same as the chimney builder. The
 * dormer's `position` is segment-local: X = width axis (along the eave),
 * Z = depth axis (projecting down-slope; +Z is the front/window face).
 * `rotation` is yaw. Rotations are negated for the floor plan's y-down
 * convention (see `buildRoofSegmentFloorplan`).
 *
 * Per-type roof linework follows the dormer's own roof geometry
 * (`buildDormerCutShape` in csg-geometry.ts): gable ridge runs along Z,
 * shed slopes high-at-back (−Z) to low-at-front (+Z), hip ridges along the
 * longer axis. Gambrel falls back to gable; dutch/mansard to hip — the
 * same fallbacks the 3D cut uses.
 */
export function buildDormerFloorplan(
  node: DormerNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const segment = ctx.parent as RoofSegmentNode | null
  if (segment?.type !== 'roof-segment') return null
  const roofId = segment.parentId as AnyNodeId | null
  const roof = roofId ? (ctx.resolve(roofId) as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  // Compose roof → segment → dormer in plan coords. Each rotation negated
  // so SVG's y-down CW matches Three.js' top-down CCW.
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

  // Reads as a small structure on the roof — neutral grey, accent on
  // select, light blue on hover.
  const baseInk = '#52525b'
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : baseInk
  const fill = showSelectedChrome ? '#fed7aa' : '#e4e4e7'
  const fillOpacity = showSelectedChrome ? 0.55 : 0.6
  const lineWidth = showSelectedChrome ? 0.03 : 0.022
  const ridgeWidth = showSelectedChrome ? 0.04 : 0.03

  const hw = Math.max(node.width, 0.1) / 2
  const hd = Math.max(node.depth, 0.1) / 2

  const corners: FloorplanPoint[] = [
    toPlan(-hw, -hd),
    toPlan(hw, -hd),
    toPlan(hw, hd),
    toPlan(-hw, hd),
  ]

  const children: FloorplanGeometry[] = [
    // Transparent hit-target across the footprint.
    {
      kind: 'polygon',
      points: corners,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    },
    // Body footprint, filled.
    {
      kind: 'polygon',
      points: corners,
      fill,
      fillOpacity,
      stroke,
      strokeWidth: lineWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    },
  ]

  const line = (a: readonly [number, number], b: readonly [number, number], w: number) => {
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
      pointerEvents: 'none',
    })
  }

  // Roof linework per dormer roof type (skipped for flat / zero-height).
  const type = node.roofType
  if (node.roofHeight > 0 && type !== 'flat') {
    if (type === 'shed') {
      // Slopes from the high back (−Z) down to the low front (+Z); show a
      // downslope arrow pointing toward the front.
      const tail = toPlan(0, -hd * 0.55)
      const head = toPlan(0, hd * 0.55)
      const dx = head[0] - tail[0]
      const dy = head[1] - tail[1]
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const headLen = Math.min(0.25, len * 0.4)
      const wing = headLen * 0.6
      children.push({
        kind: 'line',
        x1: tail[0],
        y1: tail[1],
        x2: head[0],
        y2: head[1],
        stroke,
        strokeWidth: lineWidth,
        strokeLinecap: 'round',
        pointerEvents: 'none',
      })
      children.push({
        kind: 'polyline',
        points: [
          [head[0] - headLen * ux - wing * uy, head[1] - headLen * uy + wing * ux],
          [head[0], head[1]],
          [head[0] - headLen * ux + wing * uy, head[1] - headLen * uy - wing * ux],
        ],
        stroke,
        strokeWidth: lineWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        pointerEvents: 'none',
      })
    } else if (type === 'hip' || type === 'dutch' || type === 'mansard') {
      // Ridge along the longer axis + four hips from the corners (a single
      // apex when square). Mirrors the dormer cut's pyramid/hip.
      if (Math.abs(hw - hd) < 0.01) {
        line([-hw, -hd], [0, 0], lineWidth)
        line([hw, -hd], [0, 0], lineWidth)
        line([hw, hd], [0, 0], lineWidth)
        line([-hw, hd], [0, 0], lineWidth)
      } else if (hd >= hw) {
        const rl = hd - hw // ridge along Z
        line([0, -rl], [0, rl], ridgeWidth)
        line([-hw, hd], [0, rl], lineWidth)
        line([hw, hd], [0, rl], lineWidth)
        line([-hw, -hd], [0, -rl], lineWidth)
        line([hw, -hd], [0, -rl], lineWidth)
      } else {
        const rl = hw - hd // ridge along X
        line([-rl, 0], [rl, 0], ridgeWidth)
        line([-hw, -hd], [-rl, 0], lineWidth)
        line([-hw, hd], [-rl, 0], lineWidth)
        line([hw, -hd], [rl, 0], lineWidth)
        line([hw, hd], [rl, 0], lineWidth)
      }
    } else {
      // Gable (and gambrel fallback): ridge runs front-to-back along Z.
      line([0, -hd], [0, hd], ridgeWidth)
    }
  }

  // Window on the +Z (front) face — a line just inside the front edge,
  // spanning the window width centred at its X offset. Marks the glazing
  // and which way the dormer faces.
  const ww = node.windowWidth ?? 0
  if (ww > 0.01) {
    const halfWin = Math.min(ww, node.width) / 2
    const center = Math.max(-hw + halfWin, Math.min(hw - halfWin, node.windowOffsetX ?? 0))
    const inset = Math.min(hd * 0.2, 0.08)
    line([center - halfWin, hd - inset], [center + halfWin, hd - inset], lineWidth)
  }

  return { kind: 'group', children }
}

import type {
  AnyNodeId,
  ChimneyNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { flueXPositions } from './geometry'

/**
 * Floor-plan builder for a chimney. A chimney is a masonry stack hosted on
 * a roof segment. Seen from above it reads as its crown/cap footprint with
 * the body shaft nested inside (the cap overhangs the body) and the flue
 * openings poking out the top.
 *
 * Coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → chimney). The chimney's `position` is
 * segment-local (X = width axis, Z = depth axis; Y is ignored — the 3D
 * renderer anchors it to the slope). `rotation` is yaw. We compose with
 * the floor-plan's negated-rotation convention (see
 * `buildRoofSegmentFloorplan`). Unlike the gutter there's no eave/overhang
 * offset — a chimney sits at its own footprint, not on the drip edge.
 */
export function buildChimneyFloorplan(
  node: ChimneyNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const segment = ctx.parent as RoofSegmentNode | null
  if (segment?.type !== 'roof-segment') return null
  const roofId = segment.parentId as AnyNodeId | null
  const roof = roofId ? (ctx.resolve(roofId) as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  // Compose roof → segment → chimney in plan coords. Each rotation is
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

  // Masonry — warm stone grey, accent on select, light blue on hover.
  const baseInk = '#44403c'
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : baseInk
  const fill = showSelectedChrome ? '#fed7aa' : '#d6d3d1'
  const fillOpacity = showSelectedChrome ? 0.55 : 0.6
  const lineWidth = showSelectedChrome ? 0.03 : 0.022

  const isRound = node.bodyShape === 'round'
  const halfW = Math.max(node.width, 0.05) / 2
  // Round bodies use `width` as the diameter and ignore `depth`.
  const halfD = isRound ? halfW : Math.max(node.depth, 0.05) / 2
  const hasCap = node.cap && node.capShape !== 'none'
  const overhang = hasCap ? Math.max(node.capOverhang, 0) : 0
  const capHalfW = halfW + overhang
  const capHalfD = halfD + overhang
  const showBodyInset = hasCap && overhang > 0.001

  const children: FloorplanGeometry[] = []

  if (isRound) {
    const c = toPlan(0, 0)
    // Transparent hit-target across the crown footprint.
    children.push({
      kind: 'circle',
      cx: c[0],
      cy: c[1],
      r: capHalfW,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    })
    // Crown / outer body footprint, filled.
    children.push({
      kind: 'circle',
      cx: c[0],
      cy: c[1],
      r: capHalfW,
      fill,
      fillOpacity,
      stroke,
      strokeWidth: lineWidth,
      pointerEvents: 'none',
    })
    // Body shaft inside the cap overhang.
    if (showBodyInset) {
      children.push({
        kind: 'circle',
        cx: c[0],
        cy: c[1],
        r: halfW,
        fill: 'none',
        stroke,
        strokeWidth: lineWidth * 0.8,
        strokeOpacity: 0.7,
        pointerEvents: 'none',
      })
    }
  } else {
    const capCorners: FloorplanPoint[] = [
      toPlan(-capHalfW, -capHalfD),
      toPlan(capHalfW, -capHalfD),
      toPlan(capHalfW, capHalfD),
      toPlan(-capHalfW, capHalfD),
    ]
    children.push({
      kind: 'polygon',
      points: capCorners,
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    })
    children.push({
      kind: 'polygon',
      points: capCorners,
      fill,
      fillOpacity,
      stroke,
      strokeWidth: lineWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
    if (showBodyInset) {
      children.push({
        kind: 'polygon',
        points: [
          toPlan(-halfW, -halfD),
          toPlan(halfW, -halfD),
          toPlan(halfW, halfD),
          toPlan(-halfW, halfD),
        ],
        fill: 'none',
        stroke,
        strokeWidth: lineWidth * 0.8,
        strokeOpacity: 0.7,
        strokeLinejoin: 'miter',
        pointerEvents: 'none',
      })
    }
  }

  // Flue openings poking out the crown — drawn along the chimney's local X
  // at z = 0, matching `flueXPositions` (the same layout the 3D pots use).
  // Round or square per `flueShape`. Hollow so they read as openings.
  const flueCount = Math.max(0, Math.min(4, node.flueCount))
  if (flueCount > 0) {
    const d = Math.max(0.02, node.flueDiameter)
    const r = d / 2
    const xs = flueXPositions(flueCount, node.width, d, node.flueSpacing)
    const flueStroke = showSelectedChrome && palette ? palette.selectedStroke : '#292524'
    for (const fx of xs) {
      if (node.flueShape === 'square') {
        children.push({
          kind: 'polygon',
          points: [toPlan(fx - r, -r), toPlan(fx + r, -r), toPlan(fx + r, r), toPlan(fx - r, r)],
          fill: 'none',
          stroke: flueStroke,
          strokeWidth: lineWidth * 0.8,
          strokeLinejoin: 'miter',
          pointerEvents: 'none',
        })
      } else {
        const c = toPlan(fx, 0)
        children.push({
          kind: 'circle',
          cx: c[0],
          cy: c[1],
          r,
          fill: 'none',
          stroke: flueStroke,
          strokeWidth: lineWidth * 0.8,
          pointerEvents: 'none',
        })
      }
    }
  }

  return { kind: 'group', children }
}

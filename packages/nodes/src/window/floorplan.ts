import type {
  AnyNodeId,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { cornerPair, getWallBodyCenterOffset } from '@pascal-app/core'
import { floorplanGeometryMetadata, readFloorplanContext } from '@pascal-app/editor'
import {
  buildOpeningMarkAnnotation,
  type OpeningFloorplanLevelData,
} from '../shared/opening-documentation'
import { buildOpeningPlacementDimensions } from '../shared/opening-placement-dimensions'
import { resolveOpeningPlanPlane } from '../shared/opening-plane-offset'

type Vec = readonly [number, number]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1]

/**
 * Where a corner window ends at its corner: on the mitre its wall meets the partner's wall along,
 * which the 3D cut opens up to, so the two sides meet there and the corner reads as glass rather
 * than a wall post. `at(v)` is the mitre's along-wall position (from the wall's start) at a
 * perpendicular offset `v` from the wall's reference line. Null when the window is not one side of
 * a corner pair.
 */
function cornerMitre(node: WindowNode, wall: WallNode, ctx: GeometryContext) {
  const partnerId = node.corner?.partnerId as AnyNodeId | undefined
  const partner = partnerId ? ctx.resolve<WindowNode>(partnerId) : undefined
  const partnerWall = partner?.parentId
    ? ctx.resolve<WallNode>(partner.parentId as AnyNodeId)
    : undefined
  if (partner?.type !== 'window' || partnerWall?.type !== 'wall') return null
  const pair = cornerPair(
    { [node.id]: node, [wall.id]: wall, [partner.id]: partner, [partnerWall.id]: partnerWall },
    node,
  )
  if (!pair) return null
  const into = (from: Vec, to: Vec): Vec => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    return [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
  }
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const dir = into(wall.start, wall.end)
  const perp: Vec = [-dir[1], dir[0]]
  const away = pair.end === 'start' ? dir : ([-dir[0], -dir[1]] as const)
  const otherDir = into(partnerWall.start, partnerWall.end)
  const otherPerp: Vec = [-otherDir[1], otherDir[0]]
  const otherAway =
    partner.corner?.end === 'start' ? otherDir : ([-otherDir[0], -otherDir[1]] as const)
  const half = (wall.thickness ?? 0.1) / 2
  const otherHalf = (partnerWall.thickness ?? 0.1) / 2
  // Each wall's face toward the other meets the other's face toward it; the outer faces meet too.
  const side = Math.sign(dot(otherAway, perp)) || 1
  const otherSide = Math.sign(dot(away, otherPerp)) || 1
  const inner = getWallBodyCenterOffset(wall) + side * half
  const outer = getWallBodyCenterOffset(wall) - side * half
  const otherInner = getWallBodyCenterOffset(partnerWall) + otherSide * otherHalf
  const otherOuter = getWallBodyCenterOffset(partnerWall) - otherSide * otherHalf
  // How far from the corner, along this wall, its face at `v` meets the other's face at `q`;
  // capped where a wall's own miter stops, at five thicknesses.
  const reach = 10 * half
  const det = away[1] * otherAway[0] - away[0] * otherAway[1]
  const meet = (v: number, q: number) => {
    const rhs: Vec = [q * otherPerp[0] - v * perp[0], q * otherPerp[1] - v * perp[1]]
    const t = (rhs[1] * otherAway[0] - rhs[0] * otherAway[1]) / det
    return Math.max(-reach, Math.min(reach, t))
  }
  const tInner = meet(inner, otherInner)
  const tOuter = meet(outer, otherOuter)
  return {
    end: pair.end,
    at: (v: number) => {
      const t = tInner + ((v - inner) * (tOuter - tInner)) / (outer - inner)
      return pair.end === 'start' ? t : length - t
    },
  }
}

/**
 * Stage C floor-plan builder for window. Mirrors the legacy
 * floorplan-panel window rendering:
 *
 *   1. Window footprint rectangle in the wall cutout (themed accent
 *      stroke when selected).
 *   2. Inset inner outline — the "glass pane" frame inside the cutout.
 *   3. Center mullion line down the middle of the opening, along the
 *      wall direction — the legacy's standard glass divider.
 *
 * Skipped vs the full legacy for now: arched / rounded opening shape
 * variants, multi-pane mullion grids.
 */
export function buildWindowFloorplan(
  node: WindowNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (wall?.type !== 'wall') return null

  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-9) return null

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX

  const distance = node.position[0]
  const width = node.width
  const wallDepth = wall.thickness ?? 0.1
  const plane = resolveOpeningPlanPlane(node, wallDepth)
  const depth = plane.depth
  // The plane offset is measured from the body centre, which a justified wall
  // sets off its reference line.
  const bodyOffset = getWallBodyCenterOffset(wall)
  const across = bodyOffset + plane.offset
  const cx = x1 + dirX * distance + perpX * across
  const cz = z1 + dirZ * distance + perpZ * across
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const halfWallDepth = wallDepth / 2
  const plan = (along: number, v: number): FloorplanPoint => [
    x1 + dirX * along + perpX * v,
    z1 + dirZ * along + perpZ * v,
  ]
  // Where the window's side edge at perpendicular offset `v` lies along the wall, `inset` in from
  // its jamb; a corner window's corner side runs to the mitre, with no jamb there.
  const mitre = cornerMitre(node, wall, ctx)
  const edge = (side: 'start' | 'end', v: number, inset = 0) =>
    mitre?.end === side
      ? mitre.at(v)
      : side === 'start'
        ? distance - halfWidth + inset
        : distance + halfWidth - inset
  const rectangle = (v: number, half: number, inset = 0): readonly FloorplanPoint[] => [
    plan(edge('start', v + half, inset), v + half),
    plan(edge('end', v + half, inset), v + half),
    plan(edge('end', v - half, inset), v - half),
    plan(edge('start', v - half, inset), v - half),
  ]
  // An offset frame stands clear of the wall centre, but the wall is still
  // cut through its whole thickness: that hole is drawn too.
  const cutoutPoints = plane.offset === 0 ? null : rectangle(bodyOffset, halfWallDepth)
  const points = rectangle(across, halfDepth)

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Same selection treatment as door — selected windows get a full
  // orange body + outline so they read as the active target. Hover takes the
  // walls' hover stroke: the window a dragged one would join at a corner is
  // outlined that way, as the 3D view outlines it.
  const accentColor = showSelectedChrome
    ? '#f97316'
    : isHovered && palette
      ? palette.wallHoverStroke
      : 'rgba(31, 41, 55, 0.92)'
  const fillColor = showSelectedChrome ? '#fed7aa' : 'rgba(255, 255, 255, 0.96)'

  // Inner inset rectangle (the glass pane outline). Tangent inset
  // pulls the long sides in slightly; normal inset reduces the depth.
  const tangentInset = Math.min(width * 0.08, 0.12)
  const normalInset = Math.min(depth * 0.22, 0.07)
  const innerPane = rectangle(across, halfDepth - normalInset, tangentInset)

  // Center mullion — from the midpoint of the left edge to the
  // midpoint of the right edge of the cutout.
  const mullionStart = plan(edge('start', across), across)
  const mullionEnd = plan(edge('end', across), across)

  // A sheet draws the standard window symbol in plan-metre ink, so it prints
  // the same in every back end: the two wall faces carried across the opening
  // (the outline, which closes on the jambs) and the glass line between them.
  const drafting = readFloorplanContext(ctx).drafting
  const cutout: FloorplanGeometry[] = cutoutPoints
    ? [
        drafting
          ? {
              kind: 'polygon',
              points: cutoutPoints,
              fill: '#ffffff',
              stroke: '#1f2937',
              strokeWidth: 0.01,
              strokeLinejoin: 'miter',
            }
          : {
              kind: 'polygon',
              points: cutoutPoints,
              fill: fillColor,
              stroke: accentColor,
              strokeWidth: showSelectedChrome || isHovered ? 1.9 : 1.25,
              vectorEffect: 'non-scaling-stroke',
              strokeLinejoin: 'round',
              metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
            },
      ]
    : []
  const children: FloorplanGeometry[] = drafting
    ? [
        ...cutout,
        {
          kind: 'polygon',
          points,
          fill: '#ffffff',
          stroke: '#1f2937',
          strokeWidth: 0.01,
          strokeLinejoin: 'miter',
        },
        {
          kind: 'line',
          x1: mullionStart[0],
          y1: mullionStart[1],
          x2: mullionEnd[0],
          y2: mullionEnd[1],
          stroke: '#1f2937',
          strokeWidth: 0.008,
        },
      ]
    : [
        ...cutout,
        // Outer footprint — white fill so the wall hatch underneath
        // doesn't bleed through.
        {
          kind: 'polygon',
          points,
          fill: fillColor,
          stroke: accentColor,
          strokeWidth: showSelectedChrome || isHovered ? 1.9 : 1.25,
          vectorEffect: 'non-scaling-stroke',
          strokeLinejoin: 'round',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
        },
        // Inset glass-pane outline.
        {
          kind: 'polygon',
          points: innerPane,
          fill: 'none',
          stroke: accentColor,
          strokeOpacity: 0.6,
          strokeWidth: showSelectedChrome ? 1.3 : 0.9,
          vectorEffect: 'non-scaling-stroke',
          strokeLinejoin: 'round',
        },
        // Center mullion.
        {
          kind: 'line',
          x1: mullionStart[0],
          y1: mullionStart[1],
          x2: mullionEnd[0],
          y2: mullionEnd[1],
          stroke: accentColor,
          strokeWidth: showSelectedChrome ? 1.6 : 1.1,
          strokeOpacity: 0.85,
          strokeLinecap: 'round',
          vectorEffect: 'non-scaling-stroke',
        },
      ]

  // Move handle — orange dot at the window center. Only when selected.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [cx, cz],
    })

    // Width-resize arrows at each side of the window (along the wall
    // direction). Pointer-down on either routes through the window's
    // `resize-width` affordance — anchored at the opposite edge, clamped
    // to wall bounds. Mirrors the 3D `WindowSideArrow` width drag and the
    // door's 2D pattern.
    // A scripted opening's width is its script's: its size arrows live in 3D, on its params.
    if (!node.source) {
      const startEdgeX = cx - dirX * halfWidth
      const startEdgeZ = cz - dirZ * halfWidth
      const endEdgeX = cx + dirX * halfWidth
      const endEdgeZ = cz + dirZ * halfWidth
      children.push({
        kind: 'move-arrow',
        point: [startEdgeX, startEdgeZ],
        angle: Math.atan2(-dirZ, -dirX),
        affordance: 'resize-width',
        payload: { side: 'start' },
      })
      children.push({
        kind: 'move-arrow',
        point: [endEdgeX, endEdgeZ],
        angle: Math.atan2(dirZ, dirX),
        affordance: 'resize-width',
        payload: { side: 'end' },
      })
    }
  }

  // Placement-measurement dimensions when actively moving — same
  // contract as door (see `nodes/src/door/floorplan.ts`).
  if (view?.moving && readFloorplanContext(ctx).automaticDimensions) {
    for (const dim of buildOpeningPlacementDimensions(node, ctx)) {
      children.push(dim)
    }
  }

  const markAnnotation = buildOpeningMarkAnnotation(
    node,
    wall,
    ctx.levelData as OpeningFloorplanLevelData | undefined,
    { stroke: showSelectedChrome ? '#f97316' : '#334155', drafting },
  )
  if (markAnnotation) children.push(markAnnotation)

  return { kind: 'group', children }
}

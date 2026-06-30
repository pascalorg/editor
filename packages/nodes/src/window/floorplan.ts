import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { buildOpeningPlacementDimensions } from '../shared/opening-placement-dimensions'

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
  const depth = wall.thickness ?? 0.1
  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance
  const halfWidth = width / 2
  const halfDepth = depth / 2

  const points: readonly FloorplanPoint[] = [
    [cx - dirX * halfWidth + perpX * halfDepth, cz - dirZ * halfWidth + perpZ * halfDepth],
    [cx + dirX * halfWidth + perpX * halfDepth, cz + dirZ * halfWidth + perpZ * halfDepth],
    [cx + dirX * halfWidth - perpX * halfDepth, cz + dirZ * halfWidth - perpZ * halfDepth],
    [cx - dirX * halfWidth - perpX * halfDepth, cz - dirZ * halfWidth - perpZ * halfDepth],
  ]

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Same selection treatment as door — selected windows get a full
  // orange body + outline so they read as the active target.
  const accentColor = showSelectedChrome ? '#f97316' : 'rgba(31, 41, 55, 0.92)'
  const fillColor = showSelectedChrome ? '#fed7aa' : 'rgba(255, 255, 255, 0.96)'

  // Inner inset rectangle (the glass pane outline). Tangent inset
  // pulls the long sides in slightly; normal inset reduces the depth.
  const tangentInset = Math.min(width * 0.08, 0.12)
  const normalInset = Math.min(depth * 0.22, 0.07)
  const innerStartA: FloorplanPoint = [
    cx - dirX * (halfWidth - tangentInset) + perpX * (halfDepth - normalInset),
    cz - dirZ * (halfWidth - tangentInset) + perpZ * (halfDepth - normalInset),
  ]
  const innerEndA: FloorplanPoint = [
    cx + dirX * (halfWidth - tangentInset) + perpX * (halfDepth - normalInset),
    cz + dirZ * (halfWidth - tangentInset) + perpZ * (halfDepth - normalInset),
  ]
  const innerEndB: FloorplanPoint = [
    cx + dirX * (halfWidth - tangentInset) - perpX * (halfDepth - normalInset),
    cz + dirZ * (halfWidth - tangentInset) - perpZ * (halfDepth - normalInset),
  ]
  const innerStartB: FloorplanPoint = [
    cx - dirX * (halfWidth - tangentInset) - perpX * (halfDepth - normalInset),
    cz - dirZ * (halfWidth - tangentInset) - perpZ * (halfDepth - normalInset),
  ]

  // Center mullion — from the midpoint of the left edge to the
  // midpoint of the right edge of the cutout.
  const mullionStart: FloorplanPoint = [cx - dirX * halfWidth, cz - dirZ * halfWidth]
  const mullionEnd: FloorplanPoint = [cx + dirX * halfWidth, cz + dirZ * halfWidth]

  const children: FloorplanGeometry[] = [
    // Outer footprint — white fill so the wall hatch underneath
    // doesn't bleed through.
    {
      kind: 'polygon',
      points,
      fill: fillColor,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.9 : 1.25,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    },
    // Inset glass-pane outline.
    {
      kind: 'polygon',
      points: [innerStartA, innerEndA, innerEndB, innerStartB],
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

  // Placement-measurement dimensions when actively moving — same
  // contract as door (see `nodes/src/door/floorplan.ts`).
  if (view?.moving) {
    for (const dim of buildOpeningPlacementDimensions(node, ctx)) {
      children.push(dim)
    }
  }

  return { kind: 'group', children }
}

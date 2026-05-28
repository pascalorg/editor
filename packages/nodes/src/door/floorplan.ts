import type {
  DoorNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  WallNode,
} from '@pascal-app/core'
import { buildOpeningPlacementDimensions } from '../shared/opening-placement-dimensions'

/**
 * Stage C floor-plan builder for door. 1:1 visual port of the legacy
 * floorplan-panel door rendering:
 *
 *   1. The door footprint rectangle in the wall cutout (themed
 *      accent stroke when selected).
 *   2. The door swing arc — a quarter-circle from the hinge to the
 *      door's open position, modulated by `swingAngle`, `hingesSide`,
 *      and `swingDirection`. Renders as a wedge of low-opacity fill so
 *      the swept area reads at a glance.
 *   3. The door leaf — a thick line from the hinge to the open
 *      position, terminating at the arc end.
 *   4. Center line through the cutout (matches the legacy's
 *      `getOpeningCenterLine` segment for visual continuity).
 *
 * Requires `ctx.parent` to be a wall (door.parentId is the wall it's
 * mounted on). Returns null when the parent isn't a wall (orphaned
 * doors during placement etc.).
 *
 * Skipped vs the full legacy for now: hinge / strike cubes (small
 * indicator squares at the rotation pivots), rounded-opening shape
 * variants, panic bar markers. Those are rare visual variations the
 * follow-up port can revisit.
 */
export function buildDoorFloorplan(node: DoorNode, ctx: GeometryContext): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (!wall || wall.type !== 'wall') return null

  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-9) return null

  const dirX = dx / length
  const dirZ = dz / length
  // Perpendicular unit normal (rotate 90° CCW).
  const perpX = -dirZ
  const perpZ = dirX

  const distance = node.position[0]
  const width = node.width
  const depth = wall.thickness ?? 0.1
  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance
  const halfWidth = width / 2
  const halfDepth = depth / 2

  const isPlanFlipped = isOpeningPlanFlipped(node.rotation)
  const baseHingesSide = node.hingesSide ?? 'left'
  const baseSwingDirection = node.swingDirection ?? 'inward'
  const hingesSide = isPlanFlipped ? (baseHingesSide === 'left' ? 'right' : 'left') : baseHingesSide
  const swingDirection = isPlanFlipped
    ? baseSwingDirection === 'inward'
      ? 'outward'
      : 'inward'
    : baseSwingDirection
  const swingAngle = Math.max(0, Math.min(Math.PI / 2, node.swingAngle ?? 0))

  // Footprint rectangle in the cutout.
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

  // Match the legacy floor-plan door render: unselected is a quiet
  // grey accent so the door reads as a hole in the wall, selected is
  // a full orange treatment (body + outline) so the user can see at
  // a glance which door is targeted by the inspector / move handle.
  const accentColor = showSelectedChrome ? '#f97316' : 'rgba(100, 116, 139, 0.82)'
  const accentMuted = accentColor
  const fillColor = showSelectedChrome ? '#fed7aa' : '#ffffff'

  const children: FloorplanGeometry[] = [
    // Background — the cutout is filled white so the swing arc sits on
    // a clean canvas (the wall hatch shows through otherwise).
    {
      kind: 'polygon',
      points,
      fill: fillColor,
      stroke: accentMuted,
      strokeWidth: showSelectedChrome ? 2 : 1.25,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    },
  ]

  // Swing geometry. The hinge sits at one end of the door along the
  // wall direction; the strike sits at the opposite end. The leaf
  // rotates around the hinge by `swingAngle` toward the inward /
  // outward side of the wall.
  const hingeTangentSign = hingesSide === 'left' ? 1 : -1
  const swingSign = swingDirection === 'inward' ? 1 : -1
  const hingeX = cx - dirX * halfWidth * hingeTangentSign
  const hingeZ = cz - dirZ * halfWidth * hingeTangentSign
  // Closed leaf vector points from hinge to strike (along the wall).
  const closedLeafX = dirX * width * hingeTangentSign
  const closedLeafZ = dirZ * width * hingeTangentSign

  if (swingAngle > 1e-3 && width > 1e-3) {
    // Rotate the closed leaf vector by `swingAngle * swingSign *
    // hingeTangentSign` around the hinge to get the open leaf tip.
    const angle = swingAngle * swingSign * hingeTangentSign
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const openLeafX = closedLeafX * cos - closedLeafZ * sin
    const openLeafZ = closedLeafX * sin + closedLeafZ * cos
    const tipX = hingeX + openLeafX
    const tipZ = hingeZ + openLeafZ

    // Closed leaf tip — where the leaf would land if fully closed.
    const closedTipX = hingeX + closedLeafX
    const closedTipZ = hingeZ + closedLeafZ

    // Swing arc — a path from closed tip to open tip via an arc
    // centered at the hinge. SVG's A command takes rx ry rotation
    // large-arc-flag sweep-flag x y. Sweep flag flips based on the
    // signed angle direction.
    const sweepFlag = angle >= 0 ? 1 : 0
    const arcPath = `M ${closedTipX} ${closedTipZ} A ${width} ${width} 0 0 ${sweepFlag} ${tipX} ${tipZ}`

    // Swept wedge fill (light, low opacity) — gives the door a
    // visible "this is the open zone" treatment.
    children.push({
      kind: 'path',
      d: `M ${hingeX} ${hingeZ} L ${closedTipX} ${closedTipZ} ${arcPath
        .replace(/^M [^A]+/, '')
        .trim()} Z`,
      fill: accentColor,
      fillOpacity: showSelectedChrome ? 0.08 : 0.05,
      stroke: 'none',
    })

    // The arc itself, stroked.
    children.push({
      kind: 'path',
      d: arcPath,
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.6 : 1.1,
      strokeOpacity: 0.85,
      vectorEffect: 'non-scaling-stroke',
      strokeLinecap: 'round',
    })

    // The door leaf — line from hinge to the open tip.
    children.push({
      kind: 'line',
      x1: hingeX,
      y1: hingeZ,
      x2: tipX,
      y2: tipZ,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2.4 : 1.7,
      strokeLinecap: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  }

  // Move handle — orange dot at the door center. Only visible when
  // selected. Pointer-down on this triggers `setMovingNode(door)`
  // → `FloorplanRegistryMoveOverlay` → `def.floorplanMoveTarget`.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [cx, cz],
    })

    // Width-resize arrows at each side of the door (along the wall
    // direction). Pointer-down on either routes through the door's
    // `resize-width` affordance — anchored at the opposite edge, clamped
    // to wall bounds. Mirrors the 3D `DoorSideArrow` width drag.
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

  // Placement-measurement dimensions — distances to adjacent openings
  // (or wall ends) on each side. Only visible while actively moving
  // (the user clicked Move or grabbed the orange dot).
  if (view?.moving) {
    for (const dim of buildOpeningPlacementDimensions(node, ctx)) {
      children.push(dim)
    }
  }

  return { kind: 'group', children }
}

/**
 * The opening's wall-normal orientation is encoded in the door's Y
 * rotation. When the door faces "inward" along an angle in [π/2, 3π/2],
 * the rendering needs the hinge side + swing direction flipped to
 * keep the visual swing on the correct side of the wall.
 *
 * Mirrors `isOpeningPlanFlipped` in `floorplan-panel.tsx`.
 */
function isOpeningPlanFlipped(rotation: readonly [number, number, number]): boolean {
  const normalized =
    ((((rotation[1] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) + 1e-6) % (Math.PI * 2)
  return normalized > Math.PI / 2 && normalized < (Math.PI * 3) / 2
}

import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { sanitizeShelfDimensions } from './dimensions'
import type { ShelfResizePayload } from './floorplan-affordances'
import type { ShelfNode } from './schema'

// Offsets for the floor-plan selection chrome. Resize chevrons sit a
// hair off the footprint rim; the rotate-arrow corner sits a bit further
// out so it doesn't crowd the resize arrows.
const RESIZE_ARROW_OFFSET = 0.12
const ROTATE_ARROW_CORNER_OFFSET = 0.22

/**
 * 2D floor-plan representation of a shelf. The unit's outer footprint
 * projects to a rectangle of `width × depth` centered on the shelf's
 * position, rotated by its Y angle. For `bookshelf` / `cubby` with
 * columns > 1, vertical column dividers project as thin lines so the
 * grid is legible from above.
 *
 * Brackets / posts / individual boards are intentionally omitted — they
 * stack vertically under the topmost board from a top-down view and
 * adding them clutters the plan without conveying useful information.
 *
 * When selected, emits resize chevrons matching the 3D handle set
 * (width on +X, depth on +Z) plus a rotate-arrow at the front-right
 * corner. Body move continues to flow through `shelfFloorplanMoveTarget`
 * (engaged from the action-menu Move button, not from these arrows).
 */
export function buildShelfFloorplan(node: ShelfNode, ctx?: GeometryContext): FloorplanGeometry {
  const shelf = sanitizeShelfDimensions(node)
  const [px, , pz] = shelf.position
  const ry = shelf.rotation[1] ?? 0
  // Floor-plan plots at `-ry` so SVG's CW-with-y-down `rotate` direction
  // ends up visually matching Three.js Y-rotation (CCW from a top-down
  // view) — same `rotation` value rotates the same way in both views.
  // Stair already does this; column / shelf / roof-segment now do too.
  const planRy = -ry
  const halfW = shelf.width / 2
  const halfD = shelf.depth / 2
  const isSelected = ctx?.viewState?.selected ?? false

  // Floor-plan fill: a single neutral fill regardless of `material`.
  // 2D doesn't render the actual paint material — surfaces in plan view
  // read as outline + tone, not photoreal texture.
  const footprintChildren: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfW,
      y: -halfD,
      width: shelf.width,
      height: shelf.depth,
      fill: '#d6d3d1',
      stroke: '#1f2937',
      strokeWidth: 0.015,
      opacity: 0.9,
    },
  ]

  // Show column dividers for grid-style shelves so the cubby / bookshelf
  // grid is visible from above.
  if ((shelf.style === 'bookshelf' || shelf.style === 'cubby') && shelf.columns > 1) {
    const innerWidth = shelf.width - 2 * shelf.thickness
    const colStep = innerWidth / shelf.columns
    for (let c = 1; c < shelf.columns; c++) {
      const x = -innerWidth / 2 + c * colStep
      footprintChildren.push({
        kind: 'line',
        x1: x,
        y1: -halfD + shelf.thickness,
        x2: x,
        y2: halfD - shelf.thickness,
        stroke: '#1f2937',
        strokeWidth: 0.012,
        opacity: 0.7,
      })
    }
  }

  const footprintGroup: FloorplanGeometry = {
    kind: 'group',
    transform: { translate: [px, pz], rotate: planRy },
    children: footprintChildren,
  }

  if (!isSelected) {
    return footprintGroup
  }

  // Selection chrome lives in world coords (not under the rotated
  // transform group) so the cursor projection in the affordance can use
  // the same coord system the dispatcher's `planPoint` arrives in.
  // `planRy` (= -ry) is the rotation the SVG group uses; arrows and
  // their plan-coord projections must use the same.
  const cosR = Math.cos(planRy)
  const sinR = Math.sin(planRy)
  // Plan vectors for the shelf-local axes — SVG `rotate(planRy)` maps
  // local (1, 0) → (cos planRy, sin planRy) and local (0, 1) → (-sin planRy, cos planRy).
  const localXInPlan: [number, number] = [cosR, sinR]
  const localZInPlan: [number, number] = [-sinR, cosR]

  const children: FloorplanGeometry[] = [footprintGroup]

  const emitResizeArrow = (
    dim: ShelfResizePayload['dim'],
    localAxis: [number, number],
    localOffset: number,
  ) => {
    const planAxis: [number, number] = [
      localAxis[0] * cosR - localAxis[1] * sinR,
      localAxis[0] * sinR + localAxis[1] * cosR,
    ]
    children.push({
      kind: 'move-arrow',
      point: [px + planAxis[0] * localOffset, pz + planAxis[1] * localOffset],
      angle: Math.atan2(planAxis[1], planAxis[0]),
      affordance: 'shelf-resize',
      payload: { dim, planAxis } satisfies ShelfResizePayload,
    })
  }

  emitResizeArrow('width', [1, 0], halfW + RESIZE_ARROW_OFFSET)
  emitResizeArrow('depth', [0, 1], halfD + RESIZE_ARROW_OFFSET)

  // Rotate-arrow at the +X / +Z corner — matches the 3D
  // `shelfRotateHandle` corner placement so users see the rotation
  // affordance in the same quadrant across views.
  const cornerLocalX = halfW + ROTATE_ARROW_CORNER_OFFSET
  const cornerLocalZ = halfD + ROTATE_ARROW_CORNER_OFFSET
  const cornerPlanX = cornerLocalX * cosR - cornerLocalZ * sinR
  const cornerPlanY = cornerLocalX * sinR + cornerLocalZ * cosR
  // The arc-arrow's local +X reads as the radial-outward direction; the
  // diagonal corner is the (+X +Z) sum direction in shelf-local.
  const radialPlanX = localXInPlan[0] + localZInPlan[0]
  const radialPlanY = localXInPlan[1] + localZInPlan[1]
  children.push({
    kind: 'rotate-arrow',
    point: [px + cornerPlanX, pz + cornerPlanY],
    angle: Math.atan2(radialPlanY, radialPlanX),
    affordance: 'shelf-rotate',
    pivot: [px, pz],
  })

  return { kind: 'group', children }
}

import {
  ElevatorNode as ElevatorNodeSchema,
  type ElevatorNode as ElevatorNodeType,
  getElevatorCabDepth,
  getElevatorCabWidth,
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
  type HandleDescriptor,
  type NodeDefinition,
  resolveElevatorLevels,
} from '@pascal-app/core'
import { buildElevatorFloorplan } from './floorplan'
import { elevatorResizeAffordance, elevatorRotateAffordance } from './floorplan-affordances'
import { elevatorPaint } from './paint'
import { elevatorParametrics } from './parametrics'
import { ElevatorNode } from './schema'
import { elevatorSlots } from './slots'

const SIDE_HANDLE_OFFSET = 0.22
const HEIGHT_HANDLE_OFFSET = 0.3
const MOVE_FRONT_OFFSET = 0.35
const MIN_ELEVATOR_DIM = 0.6
const MIN_CAB_HEIGHT = 1.4
const ROTATE_CORNER_OFFSET = 0.4
const ROTATE_RING_OFFSET = 0.08

// Symmetric width / depth arrows around the cab footprint. The descriptor
// edits the CAB dimension (`width` / `depth`) — but the arrow must sit
// outside the SHAFT shell so it doesn't disappear inside the rendered
// elevator. Placement uses the shaft's outer extent + wall thickness +
// padding so the arrow clears the visible body on both `solid` and
// `glass` shafts. `anchor: 'center'` means dragging outward grows the
// full span 2× the pointer delta; node.position stays put.
function elevatorAxisHandle(axis: 'x' | 'z'): HandleDescriptor<ElevatorNodeType> {
  return {
    kind: 'linear-resize',
    axis,
    anchor: 'center',
    min: MIN_ELEVATOR_DIM,
    currentValue: (n) => (axis === 'x' ? n.width : n.depth),
    apply: (_n, newValue) => (axis === 'x' ? { width: newValue } : { depth: newValue }),
    placement: {
      position: (n) => {
        const cabWidth = getElevatorCabWidth(n)
        const cabDepth = getElevatorCabDepth(n)
        const wallThickness = getElevatorShaftWallThickness(n)
        const outerHalf =
          axis === 'x'
            ? getElevatorShaftWidth(n, cabWidth) / 2 + wallThickness
            : getElevatorShaftDepth(n, cabDepth) / 2 + wallThickness
        const yMid = Math.max(n.cabHeight, MIN_CAB_HEIGHT) / 2
        return axis === 'x'
          ? [outerHalf + SIDE_HANDLE_OFFSET, yMid, 0]
          : [0, yMid, outerHalf + SIDE_HANDLE_OFFSET]
      },
    },
  }
}

// Cab-height arrow — `anchor: 'min'` keeps the cab floor fixed and grows
// the cab upward. The arrow itself sits above the full SHAFT top (not
// just the cab) so a multi-level elevator's arrow appears outside the
// rendered body rather than buried inside the shaft. `resolveElevatorLevels`
// walks the building's level chain to find shaftTopY; the fallback
// (cabHeight + 0.3) matches the renderer's own when no service levels
// are configured yet.
function elevatorCabHeightHandle(): HandleDescriptor<ElevatorNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_CAB_HEIGHT,
    currentValue: (n) => Math.max(n.cabHeight, MIN_CAB_HEIGHT),
    apply: (_n, newValue) => ({ cabHeight: newValue }),
    placement: {
      position: (n, scene) => {
        const { shaftTopY } = resolveElevatorLevels(n, scene.nodes())
        const cabTop = Math.max(n.cabHeight, MIN_CAB_HEIGHT) + 0.3
        const top = Math.max(shaftTopY, cabTop)
        return [0, top + HEIGHT_HANDLE_OFFSET, 0]
      },
    },
  }
}

function elevatorOuterHalfExtents(n: ElevatorNodeType): { halfX: number; halfZ: number } {
  const cabWidth = getElevatorCabWidth(n)
  const cabDepth = getElevatorCabDepth(n)
  const wallThickness = getElevatorShaftWallThickness(n)
  return {
    halfX: getElevatorShaftWidth(n, cabWidth) / 2 + wallThickness,
    halfZ: getElevatorShaftDepth(n, cabDepth) / 2 + wallThickness,
  }
}

// Rotation handle — sits at the front-right corner of the shaft
// footprint. `arc-resize` does the angular drag math (raycasts a
// horizontal plane at the arrow's Y, measures cursor angle around the
// elevator's local origin, returns the delta to apply). On hover or
// drag the decoration ring traces the shaft's bounding circle through
// all four corners — same idiom as the column radius ring.
function elevatorRotateHandle(): HandleDescriptor<ElevatorNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    // The cursor delta `atan2(hit.z - center.z, hit.x - center.x)` ticks
    // up in the opposite handedness from three.js's Y-rotation (positive
    // Ry takes +X → -Z, while atan2(z,x) increases as we go +X → +Z).
    // Negate so dragging the cursor CCW around the elevator (as seen
    // from above) actually rotates the elevator CCW.
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      // Offset along +Z only so the gizmo sticks out the front of the
      // shaft rather than diagonally at the corner — matches the column's
      // one-direction rotate placement.
      position: (n) => {
        const { halfX, halfZ } = elevatorOuterHalfExtents(n)
        const yMid = Math.max(n.cabHeight, MIN_CAB_HEIGHT) / 2
        return [halfX, yMid, halfZ + ROTATE_CORNER_OFFSET]
      },
      // Fixed −45° tilt — leans the curve clockwise (as seen from above)
      // toward the shaft's front face.
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      // Bounding circle through the shaft corners — drawn slightly larger
      // so it sits outside the visible shell.
      radius: (n) => {
        const { halfX, halfZ } = elevatorOuterHalfExtents(n)
        return Math.hypot(halfX, halfZ) + ROTATE_RING_OFFSET
      },
      y: (n) => Math.max(n.cabHeight, MIN_CAB_HEIGHT) / 2,
    },
  }
}

function elevatorMoveHandle(): HandleDescriptor<ElevatorNodeType> {
  return {
    // Tap-to-engage: hand the elevator to its move tool (same path the
    // floating action menu's Move button takes via `setMovingNode`) so the
    // 3D grip and the floating-UI button share one move flow — green
    // bounding box, alignment guides, R/T rotation, click-to-commit.
    kind: 'tap-action',
    shape: 'move-cross',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMove(node),
    placement: {
      position: (n) => {
        const { halfZ } = elevatorOuterHalfExtents(n)
        return [0, 0.02, halfZ + MOVE_FRONT_OFFSET]
      },
    },
  }
}

const elevatorHandles: HandleDescriptor<ElevatorNodeType>[] = [
  elevatorAxisHandle('x'),
  elevatorAxisHandle('z'),
  elevatorCabHeightHandle(),
  elevatorRotateHandle(),
  elevatorMoveHandle(),
]

/**
 * Elevator — Stage A registration. Wrap-exports the legacy renderer +
 * the three legacy systems (runtime / interaction / opening) bundled
 * as one `def.system`. Move / inspector still go through legacy
 * (`MoveElevatorTool`, `<ElevatorPanel>`) via panel-manager's
 * hardcoded switch.
 */
export const elevatorDefinition: NodeDefinition<typeof ElevatorNode> = {
  kind: 'elevator',
  schemaVersion: 1,
  schema: ElevatorNode,
  category: 'structure',
  snapProfile: 'structural',
  // Placed as a footprint (R/T rotates), not a directional draw → no angle-lock
  // mode. The toolHints presence routes it through the contextual HUD so the
  // snapping chip shows during placement.
  snapDraftDirectional: false,
  toolHints: [
    { key: 'Left click', label: 'Place elevator' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Esc', label: 'Cancel' },
  ],
  surfaceRole: 'joinery',

  defaults: () => {
    const stub = ElevatorNodeSchema.parse({ id: 'elevator_default' as never, type: 'elevator' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    // Generic XZ translate so the floating action menu's Move button
    // (and the side move-arrows emitted from `def.floorplan`) drive the
    // 2D body-move flow through `FloorplanRegistryMoveOverlay`'s
    // Path 2 — position[0] / position[2] update with a 0.5m grid snap.
    movable: { axes: ['x', 'z'], gridSnap: true },
    // Align by the OUTER SHAFT (shaft + wall — what's drawn in plan and 3D),
    // not the cab `width × depth`: the cab is inset by the shaft wall +
    // clearance, so cab corners sit ~9 cm inside the visible edge — past the
    // 8 cm snap, which is why the elevator never surfaced a guide. A `box`
    // shape (not `aabb`) because the elevator is `movable`, so the anchor
    // bridge relocates this same footprint to the drag point.
    alignmentFootprint: (node) => {
      const e = node as ElevatorNodeType
      const { halfX, halfZ } = elevatorOuterHalfExtents(e)
      return {
        shape: 'box',
        dimensions: [halfX * 2, 1, halfZ * 2],
        rotation: [0, e.rotation ?? 0, 0],
      }
    },
    // Drag box wraps just the OUTER SHAFT × full shaft height — same footprint
    // alignment uses, same height the rendered shell occupies. Without this
    // override, `DragBoundingBox` would measure the whole mesh tree (per-level
    // landing assemblies, cab interior, buttons) and the box would feel
    // vertically off-centre when the elevator's lowest served level isn't the
    // building origin.
    dragBounds: (node, nodes) => {
      const e = node as ElevatorNodeType
      const { halfX, halfZ } = elevatorOuterHalfExtents(e)
      const { shaftBaseY, totalHeight } = resolveElevatorLevels(e, nodes ?? {})
      const cabHeight = Math.max(e.cabHeight, 1.4)
      const shaftHeight = Math.max(totalHeight, cabHeight + 0.3)
      return {
        size: [halfX * 2, shaftHeight, halfZ * 2],
        centerY: shaftBaseY + shaftHeight / 2,
      }
    },
    duplicable: true,
    deletable: true,
    slots: (node) => elevatorSlots(node as ElevatorNodeType),
    paint: elevatorPaint,
  },

  parametrics: elevatorParametrics,
  handles: elevatorHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  floorplan: buildElevatorFloorplan,
  // Elevators are parented to the building (siblings of levels), so the
  // floor-plan layer's level-rooted DFS never reaches them. Declaring
  // `floorplanScope: 'building'` tells `FloorplanRegistryLayer` to walk
  // building-scoped kinds separately and synthesise `ctx.parent` as the
  // active level — that's what `buildElevatorFloorplan` reads via
  // `ctx.parent?.id` to decide whether this floor is in the elevator's
  // service range.
  floorplanScope: 'building',
  // 2D drag affordance for the rotate-arrow emitted at the elevator's
  // front-right corner. Body move uses the generic move-arrow / move-
  // handle path emitted by the floor-plan builder.
  floorplanAffordances: {
    'elevator-resize': elevatorResizeAffordance,
    'elevator-rotate': elevatorRotateAffordance,
  },

  presentation: {
    label: 'Elevator',
    description: 'A multi-level elevator shaft with configurable openings per level.',
    icon: { kind: 'url', src: '/icons/wallcut.webp' },
    paletteSection: 'structure',
    paletteOrder: 80,
  },

  mcp: {
    description: 'A multi-level elevator with shaft + openings per level.',
  },
}

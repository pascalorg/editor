import {
  ColumnNode as ColumnNodeSchema,
  type ColumnNode as ColumnNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildColumnFloorplan } from './floorplan'
import { columnResizeAffordance, columnRotateAffordance } from './floorplan-affordances'
import { columnFloorplanMoveTarget } from './floorplan-move'
import { columnPaint } from './paint'
import { columnParametrics } from './parametrics'
import { ColumnNode } from './schema'
import { columnSlots } from './slots'

// Limits + offsets shared with the in-world arrows. Mirrors the floors
// the renderer clamps to (`Math.max(0.2, node.height)` etc.) so a drag
// can't push values past what the renderer will accept.
const SIDE_HANDLE_OFFSET = 0.18
const HEIGHT_HANDLE_OFFSET = 0.22
const BRACE_HANDLE_OFFSET = 0.3
const SPREAD_HANDLE_OFFSET = 0.22
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04
const MOVE_FRONT_OFFSET = 0.35
const MIN_COLUMN_HEIGHT = 0.2
const MIN_COLUMN_WIDTH = 0.1
const MIN_COLUMN_DEPTH = 0.1
const MIN_COLUMN_RADIUS = 0.05
const MIN_BRACE_DIMENSION = 0.04
const MIN_BRACE_BOTTOM_SPREAD = 0.2
const MIN_BRACE_TOP_SPREAD = 0

const ROUND_CROSS_SECTIONS = new Set<ColumnNodeType['crossSection']>([
  'round',
  'octagonal',
  'sixteen-sided',
])

function columnHeightHandle(): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_COLUMN_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: newValue }),
    placement: {
      position: (n) => [0, n.height + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

function columnRadiusHandle(): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'radial-resize',
    axis: 'x',
    min: MIN_COLUMN_RADIUS,
    currentValue: (n) => n.radius,
    apply: (_n, newValue) => ({ radius: newValue }),
    placement: {
      position: (n) => [n.radius + SIDE_HANDLE_OFFSET, n.height / 2, 0],
    },
    // Guide ring traces the column's footprint at mid-height while the
    // user is hovering or dragging the radius arrow — clarifies which
    // edge the drag controls on round / octagonal / sixteen-sided shafts.
    decoration: {
      kind: 'ring',
      radius: (n) => n.radius + SIDE_HANDLE_OFFSET * 0.5,
      y: (n) => n.height / 2,
    },
  }
}

function columnAxisHandle(axis: 'x' | 'z'): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'linear-resize',
    axis,
    anchor: 'center',
    min: axis === 'x' ? MIN_COLUMN_WIDTH : MIN_COLUMN_DEPTH,
    currentValue: (n) => (axis === 'x' ? n.width : n.depth),
    apply: (_n, newValue) => (axis === 'x' ? { width: newValue } : { depth: newValue }),
    placement: {
      position: (n) => {
        const half = axis === 'x' ? n.width / 2 : n.depth / 2
        return axis === 'x'
          ? [half + SIDE_HANDLE_OFFSET, n.height / 2, 0]
          : [0, n.height / 2, half + SIDE_HANDLE_OFFSET]
      },
    },
  }
}

function columnUniformHandle(): HandleDescriptor<ColumnNodeType> {
  // Square columns keep width === depth. We anchor the arrow on the +X
  // side and write BOTH fields from the same delta.
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_COLUMN_WIDTH,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: newValue, depth: newValue }),
    placement: {
      position: (n) => [n.width / 2 + SIDE_HANDLE_OFFSET, n.height / 2, 0],
    },
  }
}

// Bottom-spread arrow — sits just outside the right foot of the splay
// (a-frame / x-brace etc.), one beam-width above the floor plate so it
// clears the support legs. Drags symmetrically: anchor='center' so
// pointer Δ of d grows the full leg-to-leg distance by 2d, both legs
// moving ±d. Defaults mirror the renderer fall-throughs.
function columnBraceBottomSpreadHandle(): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_BRACE_BOTTOM_SPREAD,
    currentValue: (n) =>
      Math.max(MIN_BRACE_BOTTOM_SPREAD, n.braceBottomSpread ?? Math.max(n.width * 3, 1.2)),
    apply: (_n, newValue) => ({ braceBottomSpread: newValue }),
    placement: {
      position: (n) => {
        const spread = Math.max(
          MIN_BRACE_BOTTOM_SPREAD,
          n.braceBottomSpread ?? Math.max(n.width * 3, 1.2),
        )
        return [spread / 2 + SPREAD_HANDLE_OFFSET, 0.08, 0]
      },
    },
  }
}

// Top-spread arrow — at the right tip of the brace's top edge. Same
// symmetric anchor as the bottom spread. For a-frame this is the small
// "pinch" at the top; for y/v-frame and x-brace it's the wider opening.
function columnBraceTopSpreadHandle(): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_BRACE_TOP_SPREAD,
    currentValue: (n) => Math.max(MIN_BRACE_TOP_SPREAD, n.braceTopSpread ?? 0.12),
    apply: (_n, newValue) => ({ braceTopSpread: newValue }),
    placement: {
      position: (n) => {
        const spread = Math.max(MIN_BRACE_TOP_SPREAD, n.braceTopSpread ?? 0.12)
        return [spread / 2 + SPREAD_HANDLE_OFFSET, n.height + 0.08, 0]
      },
    },
  }
}

function columnBraceHandle(axis: 'x' | 'z'): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'linear-resize',
    axis,
    anchor: 'center',
    min: MIN_BRACE_DIMENSION,
    currentValue: (n) => (axis === 'x' ? (n.braceWidth ?? n.width) : (n.braceDepth ?? n.depth)),
    apply: (_n, newValue) => (axis === 'x' ? { braceWidth: newValue } : { braceDepth: newValue }),
    placement: {
      position: (n) => {
        // Position outside any splay so the arrow clears the legs.
        const half =
          axis === 'x'
            ? Math.max(n.braceBottomSpread ?? 0, n.braceTopSpread ?? 0, n.braceWidth ?? n.width) / 2
            : (n.braceDepth ?? n.depth) / 2
        return axis === 'x'
          ? [half + BRACE_HANDLE_OFFSET, n.height / 2, 0]
          : [0, n.height / 2, half + BRACE_HANDLE_OFFSET]
      },
    },
  }
}

// Which supports surface bottom-spread / top-spread in the renderer. Phase
// 1 covers the simple two-leg / single-foot supports; x-brace / k-brace /
// tripod / trestle / portal-frame / box-frame will hook the same handles
// in a follow-up once we audit their leg geometry.
const STYLES_WITH_BOTTOM_SPREAD = new Set<ColumnNodeType['supportStyle']>(['a-frame'])
const STYLES_WITH_TOP_SPREAD = new Set<ColumnNodeType['supportStyle']>([
  'a-frame',
  'y-frame',
  'v-frame',
])

// Resolve the column's visible XZ footprint half-extents per supportStyle
// + crossSection. Vertical supports use the shaft geometry (radius for
// round / octagonal / sixteen-sided, width/depth for square / rectangular);
// non-vertical supports fall back to the widest sensible brace bound so
// the rotation handle clears the splay.
function columnFootprintHalf(n: ColumnNodeType): { halfX: number; halfZ: number } {
  if (n.supportStyle === 'vertical') {
    if (ROUND_CROSS_SECTIONS.has(n.crossSection)) {
      return { halfX: n.radius, halfZ: n.radius }
    }
    if (n.crossSection === 'square') {
      return { halfX: n.width / 2, halfZ: n.width / 2 }
    }
    return { halfX: n.width / 2, halfZ: n.depth / 2 }
  }
  return {
    halfX:
      Math.max(n.width, n.braceWidth ?? 0, n.braceBottomSpread ?? 0, n.braceTopSpread ?? 0) / 2,
    halfZ: Math.max(n.depth, n.braceDepth ?? 0) / 2,
  }
}

// Whole-column rotation gizmo — same pattern as the elevator. Curved
// two-headed arrow at the +X / +Z corner of the footprint, a guide ring
// at the corner-diagonal radius on hover/drag. `apply` negates the
// angular delta so dragging the cursor CCW around the column rotates
// the column CCW (cursor atan2 ticks opposite-handed from three.js Ry).
function columnRotateHandle(): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      // Offset along +Z only so the gizmo sticks out the front of the
      // column rather than diagonally at the corner — keeps the rotate
      // arrow from crowding the +X side handles (radius / axis / uniform)
      // while still reading as attached to the column.
      position: (n) => {
        const { halfX, halfZ } = columnFootprintHalf(n)
        const yMid = Math.max(n.height, MIN_COLUMN_HEIGHT) / 2
        return [halfX, yMid, halfZ + ROTATE_CORNER_OFFSET]
      },
      // Fixed −45° tilt — leans the curve clockwise (as seen from above)
      // toward the column's front face.
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => {
        const { halfX, halfZ } = columnFootprintHalf(n)
        return Math.hypot(halfX, halfZ) + ROTATE_RING_OFFSET
      },
      y: (n) => Math.max(n.height, MIN_COLUMN_HEIGHT) / 2,
    },
  }
}

function columnMoveHandle(): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'translate',
    placement: {
      // Low to the floor at the front edge (matches the item move grip) so it
      // reads as a floor-move grip and stays clear of the body resize / rotate
      // handles that sit at mid-height.
      position: (n) => {
        const { halfZ } = columnFootprintHalf(n)
        return [0, 0.02, halfZ + MOVE_FRONT_OFFSET]
      },
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: (n) => {
      const { halfX, halfZ } = columnFootprintHalf(n)
      const dimX = Math.max(halfX * 2, MIN_COLUMN_WIDTH)
      const dimZ = Math.max(halfZ * 2, MIN_COLUMN_DEPTH)
      const swap = Math.abs(Math.sin(n.rotation ?? 0)) > 0.9
      return [swap ? dimZ : dimX, swap ? dimX : dimZ]
    },
  }
}

function columnHandles(node: ColumnNodeType): HandleDescriptor<ColumnNodeType>[] {
  // 1. Height (universal).
  // 2. Footprint arrows depending on supportStyle + crossSection:
  //    - non-vertical supports → braceWidth + braceDepth (skips crossSection)
  //      plus per-style spread arrows at the splay endpoints.
  //    - round / octagonal / sixteen-sided → single radius arrow
  //    - square                            → uniform width+depth
  //    - rectangular                       → width + depth (independent)
  const handles: HandleDescriptor<ColumnNodeType>[] = [columnHeightHandle()]
  if (node.supportStyle !== 'vertical') {
    handles.push(columnBraceHandle('x'), columnBraceHandle('z'))
    if (STYLES_WITH_BOTTOM_SPREAD.has(node.supportStyle)) {
      handles.push(columnBraceBottomSpreadHandle())
    }
    if (STYLES_WITH_TOP_SPREAD.has(node.supportStyle)) {
      handles.push(columnBraceTopSpreadHandle())
    }
  } else if (ROUND_CROSS_SECTIONS.has(node.crossSection)) {
    handles.push(columnRadiusHandle())
  } else if (node.crossSection === 'square') {
    handles.push(columnUniformHandle())
  } else {
    handles.push(columnAxisHandle('x'), columnAxisHandle('z'))
  }
  handles.push(columnRotateHandle(), columnMoveHandle())
  return handles
}

/**
 * Column — Stage A registration. Wrap-export of the legacy
 * `ColumnRenderer` (no system — column geometry is computed inline in
 * the renderer). Inspector / floorplan still go through legacy paths via
 * panel-manager.tsx / floorplan-panel.tsx (their hardcoded `case 'column':`
 * entries fire before the registry fallback).
 *
 * Capabilities: column declares the generic `movable` (translate on XZ
 * with grid snap), so its 3D move runs through the shared
 * `MoveRegistryNodeTool` — which gives it grid/line/off snapping, alignment,
 * R/T rotation, slab-elevation lift, and the `collides` red/green placement
 * box for free. (2D move still routes through `floorplanMoveTarget`, which
 * wins the 2D dispatch.)
 *
 * Defaults computed via stub-parse so we leverage every zod
 * `.default()` annotation on the schema (~60 fields).
 */
export const columnDefinition: NodeDefinition<typeof ColumnNode> = {
  kind: 'column',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: ColumnNode,
  category: 'structure',
  surfaceRole: 'wall',

  defaults: () => {
    const stub = ColumnNodeSchema.parse({ id: 'column_default' as never, type: 'column' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Generic 3D translate-on-XZ via `MoveRegistryNodeTool` (grid snap + the
    // mode-driven snapping the overhaul standardised). 2D move keeps using
    // `floorplanMoveTarget`, which wins the 2D move dispatch.
    movable: { axes: ['x', 'z'], gridSnap: true },
    slots: (node) => columnSlots(node as ColumnNodeType),
    paint: columnPaint,
    // Slab elevation lift via the generic `<FloorElevationSystem>` + the
    // placement/collision box. Use the VISIBLE footprint (round → radius,
    // square → width, rectangular → width/depth, plus brace spread) so the
    // box, slab-overlap, and collision all track the real column size rather
    // than the raw width/depth (stale for a round column resized by radius).
    floorPlaced: {
      footprint: (node) => {
        const column = node as ColumnNodeType
        const { halfX, halfZ } = columnFootprintHalf(column)
        return {
          dimensions: [halfX * 2, column.height, halfZ * 2] as [number, number, number],
          // Column stores Y rotation as a scalar; the slab-overlap query
          // expects the full Euler tuple.
          rotation: [0, column.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
  },

  parametrics: columnParametrics,
  handles: columnHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  // Registry-driven placement tool — renders a translucent `ColumnPreview`
  // ghost at the cursor (mirroring the shelf build tool) instead of the
  // bare sphere the legacy editor-side `ColumnTool` showed. `ToolManager`'s
  // registry-first path mounts this and skips the legacy `<ColumnTool>`.
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place column' },
    { key: 'Esc', label: 'Cancel' },
  ],
  floorplan: buildColumnFloorplan,
  // 2D body move routes through this kind-specific target so the column
  // aligns by its footprint *edges* (and snaps flush to wall faces) instead
  // of the overlay's generic free-translate path, which aligned by bbox
  // centre and gathered candidates from SVG bounding boxes only. Mirrors the
  // shelf move target.
  floorplanMoveTarget: columnFloorplanMoveTarget,
  // 2D drag affordances — `column-resize` handles every dimension arrow
  // the floor-plan builder emits per cross-section / support style (the
  // payload's `dim` field discriminates radius / uniform / width / depth
  // / brace-width / brace-depth / spreads). `column-rotate` powers the
  // corner rotate-arrow.
  floorplanAffordances: {
    'column-resize': columnResizeAffordance,
    'column-rotate': columnRotateAffordance,
  },

  presentation: {
    label: 'Column',
    description: 'A parametric column with configurable cross-section, base, and capital.',
    icon: { kind: 'url', src: '/icons/column.webp' },
    paletteSection: 'structure',
    paletteOrder: 70,
  },

  mcp: {
    description: 'A parametric column placed on a slab or level.',
  },
}

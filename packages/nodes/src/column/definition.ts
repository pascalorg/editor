import {
  ColumnNode as ColumnNodeSchema,
  type ColumnNode as ColumnNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildColumnFloorplan } from './floorplan'
import { columnParametrics } from './parametrics'
import { ColumnNode } from './schema'

// Limits + offsets shared with the in-world arrows. Mirrors the floors
// the renderer clamps to (`Math.max(0.2, node.height)` etc.) so a drag
// can't push values past what the renderer will accept.
const SIDE_HANDLE_OFFSET = 0.18
const HEIGHT_HANDLE_OFFSET = 0.22
const BRACE_HANDLE_OFFSET = 0.3
const MIN_COLUMN_HEIGHT = 0.2
const MIN_COLUMN_WIDTH = 0.1
const MIN_COLUMN_DEPTH = 0.1
const MIN_COLUMN_RADIUS = 0.05
const MIN_BRACE_DIMENSION = 0.04

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

function columnBraceHandle(axis: 'x' | 'z'): HandleDescriptor<ColumnNodeType> {
  return {
    kind: 'linear-resize',
    axis,
    anchor: 'center',
    min: MIN_BRACE_DIMENSION,
    currentValue: (n) =>
      axis === 'x' ? (n.braceWidth ?? n.width) : (n.braceDepth ?? n.depth),
    apply: (_n, newValue) =>
      axis === 'x' ? { braceWidth: newValue } : { braceDepth: newValue },
    placement: {
      position: (n) => {
        // Position outside any splay so the arrow clears the legs.
        const half =
          axis === 'x'
            ? Math.max(
                n.braceBottomSpread ?? 0,
                n.braceTopSpread ?? 0,
                n.braceWidth ?? n.width,
              ) / 2
            : (n.braceDepth ?? n.depth) / 2
        return axis === 'x'
          ? [half + BRACE_HANDLE_OFFSET, n.height / 2, 0]
          : [0, n.height / 2, half + BRACE_HANDLE_OFFSET]
      },
    },
  }
}

function columnHandles(node: ColumnNodeType): HandleDescriptor<ColumnNodeType>[] {
  // 1. Height (universal).
  // 2. Footprint arrows depending on supportStyle + crossSection:
  //    - non-vertical supports → braceWidth + braceDepth (skips crossSection)
  //    - round / octagonal / sixteen-sided → single radius arrow
  //    - square                            → uniform width+depth
  //    - rectangular                       → width + depth (independent)
  const handles: HandleDescriptor<ColumnNodeType>[] = [columnHeightHandle()]
  if (node.supportStyle !== 'vertical') {
    handles.push(columnBraceHandle('x'), columnBraceHandle('z'))
  } else if (ROUND_CROSS_SECTIONS.has(node.crossSection)) {
    handles.push(columnRadiusHandle())
  } else if (node.crossSection === 'square') {
    handles.push(columnUniformHandle())
  } else {
    handles.push(columnAxisHandle('x'), columnAxisHandle('z'))
  }
  return handles
}

/**
 * Column — Stage A registration. Wrap-export of the legacy
 * `ColumnRenderer` (no system — column geometry is computed inline in
 * the renderer). Inspector / move / floorplan still go through legacy
 * paths via panel-manager.tsx / item-move-tool.tsx / floorplan-panel.tsx
 * (their hardcoded `case 'column':` entries fire before the registry
 * fallback).
 *
 * Capabilities: column doesn't declare `movable` because its move is
 * bespoke (legacy MoveColumnTool snaps to slab + free placement on
 * the X/Z plane with rotation).
 *
 * Defaults computed via stub-parse so we leverage every zod
 * `.default()` annotation on the schema (~60 fields).
 */
export const columnDefinition: NodeDefinition<typeof ColumnNode> = {
  kind: 'column',
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
    // Slab elevation lift via the generic `<FloorElevationSystem>`.
    floorPlaced: {
      footprint: (node) => {
        const column = node as ColumnNodeType
        return {
          dimensions: [column.width, column.height, column.depth] as [number, number, number],
          // Column stores Y rotation as a scalar; the slab-overlap query
          // expects the full Euler tuple.
          rotation: [0, column.rotation, 0] as [number, number, number],
        }
      },
    },
  },

  parametrics: columnParametrics,
  handles: columnHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  // Stage D — 3D move-tool (registry-driven). Replaces the legacy
  // `MoveColumnTool` in editor's dispatcher. Same 0.5m grid snap +
  // live-transform preview the legacy used.
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  floorplan: buildColumnFloorplan,

  presentation: {
    label: 'Column',
    description: 'A parametric column with configurable cross-section, base, and capital.',
    icon: { kind: 'url', src: '/icons/column.png' },
    paletteSection: 'structure',
    paletteOrder: 70,
  },

  mcp: {
    description: 'A parametric column placed on a slab or level.',
  },
}

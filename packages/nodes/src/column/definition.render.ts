import {
  ColumnNode as ColumnNodeSchema,
  type ColumnNode as ColumnNodeType,
  columnSlots,
  type GroupMoveSnapArgs,
  type GroupMoveSnapResult,
  NEW_COLUMN_SLOTS,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { columnBatchable } from '../shared/node-batch/batchable'
import {
  collectStructuralGridAxes,
  resolveStructuralGridSnap,
} from '../structural-grid/coordination'
import { columnFootprintHalf } from './bounds'
import { isManagedColumn } from './edit-policy'
import { buildColumnFloorplan, computeColumnFloorplanLevelData } from './floorplan'
import { ColumnNode } from './schema'
import { columnSurfaceProvider } from './surface'

function resolveColumnStructuralGridMoveSnap({
  candidatePosition,
  nodes,
  levelId,
}: GroupMoveSnapArgs): GroupMoveSnapResult | null {
  const snap = resolveStructuralGridSnap(
    [candidatePosition[0], candidatePosition[2]],
    collectStructuralGridAxes(nodes, levelId),
  )
  return snap ? { position: [snap.point[0], candidatePosition[1], snap.point[1]] } : null
}

export const columnRenderDefinition: NodeRenderDefinition<typeof ColumnNode> & { kind: 'column' } =
  {
    kind: 'column',
    schemaVersion: 1,
    schema: ColumnNode,
    category: 'structure',
    surfaceRole: 'wall',
    defaults: () => {
      const stub = ColumnNodeSchema.parse({ id: 'column_default' as never, type: 'column' })
      const { id: _id, type: _type, ...rest } = stub
      return { ...rest, slots: { ...NEW_COLUMN_SLOTS } }
    },
    capabilities: {
      reveal: { phase: 'structure', style: 'drop', height: 4 },
      revealOnEdit: ['height', 'radius', 'width', 'depth', 'crossSection', 'shaftProfile', 'style'],
      batchable: columnBatchable,
      surfacePlacement: 'floor-only',
      selectable: { hitVolume: 'bbox' },
      surfaces: {
        top: { height: (node) => (node as ColumnNodeType).height },
        hosting: columnSurfaceProvider,
      },
      duplicable: {
        subtree: true,
        allow: ({ node }) => !isManagedColumn(node as ColumnNodeType),
      },
      deletable: true,
      // Generic 3D translate-on-XZ via `MoveRegistryNodeTool` (grid snap + the
      // mode-driven snapping the overhaul standardised). 2D move keeps using
      // `floorplanMoveTarget`, which wins the 2D move dispatch.
      movable: {
        override: ({ node }) =>
          isManagedColumn(node as ColumnNodeType) ? { axes: [], gridSnap: false } : null,
        axes: ['x', 'z'],
        gridSnap: true,
        groupMoveSnapPose: resolveColumnStructuralGridMoveSnap,
      },
      slots: (node) => columnSlots(node as ColumnNodeType),
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
    renderer: {
      kind: 'parametric',
      module: () => import('./renderer'),
    },
    computeFloorplanLevelData: computeColumnFloorplanLevelData,
    floorplan: buildColumnFloorplan,
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

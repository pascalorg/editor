import {
  ColumnNode as ColumnNodeSchema,
  type ColumnNode as ColumnNodeType,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildColumnFloorplan } from './floorplan'
import { columnParametrics } from './parametrics'
import { ColumnNode } from './schema'

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

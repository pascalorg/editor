import { type NodeDefinition, SteelFrameNode as SteelFrameNodeSchema } from '@pascal-app/core'
import { buildSteelFrameFloorplan } from './floorplan'
import { buildSteelFrameGeometry } from './geometry'
import { steelFrameParametrics } from './parametrics'
import { SteelFrameNode } from './schema'

export const steelFrameDefinition: NodeDefinition<typeof SteelFrameNode> = {
  kind: 'steel-frame',
  schemaVersion: 1,
  schema: SteelFrameNode,
  category: 'structure',

  defaults: () => {
    const stub = SteelFrameNodeSchema.parse({
      id: 'steel-frame_default' as never,
      type: 'steel-frame',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    floorPlaced: {
      footprint: (node) => {
        const frame = node as SteelFrameNodeSchema
        return {
          dimensions: [frame.length, frame.height, frame.width] as [number, number, number],
          rotation: frame.rotation,
        }
      },
    },
  },

  parametrics: steelFrameParametrics,
  geometry: buildSteelFrameGeometry,
  floorplan: buildSteelFrameFloorplan,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '放置钢架' },
    { key: 'R / T', label: '移动时旋转' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: '钢架',
    description:
      'Industrial steel frame with pipe-rack, platform, portal-frame, and tower-frame styles.',
    icon: { kind: 'url', src: '/icons/column.webp' },
    paletteSection: 'structure',
    paletteOrder: 18,
  },

  mcp: {
    description:
      'Parametric outdoor industrial steel frame. Editable style, brace pattern, levels, column grid, rows, size, member sizes, and colors.',
  },
}

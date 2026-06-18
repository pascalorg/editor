import type { NodeDefinition } from '@pascal-app/core'
import { buildSteelBeamFloorplan } from './floorplan'
import { buildSteelBeamGeometry } from './geometry'
import { steelBeamParametrics } from './parametrics'
import { SteelBeamNode } from './schema'

export const steelBeamDefinition: NodeDefinition<typeof SteelBeamNode> = {
  kind: 'steel-beam',
  schemaVersion: 1,
  schema: SteelBeamNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    curveOffset: 0,
    elevation: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    profile: 'i-beam',
    length: 3,
    height: 0.32,
    width: 0.18,
    flangeThickness: 0.045,
    webThickness: 0.035,
    color: '#7f8792',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  relations: {
    linkedBy: 'endpoint-match',
    cascadeDelete: 'none',
  },

  parametrics: steelBeamParametrics,
  tool: () => import('./tool'),
  geometry: buildSteelBeamGeometry,
  floorplan: buildSteelBeamFloorplan,

  affordanceTools: {
    curve: () => import('./curve-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  toolHints: [
    { key: 'Left click', label: '设置钢梁起点 / 终点' },
    { key: 'Shift', label: '按住关闭角度吸附' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Steel Beam',
    description:
      'An editable structural steel beam route with I, hollow box, channel, and concave profiles.',
    icon: { kind: 'url', src: '/icons/column.webp' },
    paletteSection: 'structure',
    paletteOrder: 23,
  },

  mcp: {
    description:
      'Structural steel beam route with editable centerline, curve, section profile, height, width, flange thickness, and web thickness.',
  },
}

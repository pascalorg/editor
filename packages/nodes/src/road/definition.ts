import type { NodeDefinition } from '@pascal-app/core'
import { buildRoadFloorplan } from './floorplan'
import { buildRoadGeometry } from './geometry'
import { roadParametrics } from './parametrics'
import { RoadNode } from './schema'

export const roadDefinition: NodeDefinition<typeof RoadNode> = {
  kind: 'road',
  schemaVersion: 1,
  schema: RoadNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [5, 0],
    curveOffset: 0,
    width: 3.5,
    thickness: 0.04,
    elevation: 0.01,
    laneCount: 2,
    showLaneMarkings: true,
    asphaltColor: '#2f3338',
    markingColor: '#f8fafc',
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

  parametrics: roadParametrics,

  tool: () => import('./tool'),

  geometry: buildRoadGeometry,
  floorplan: buildRoadFloorplan,

  affordanceTools: {
    curve: () => import('./curve-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  toolHints: [
    { key: 'Left click', label: '设置道路起点 / 终点' },
    { key: 'Shift', label: '按住关闭角度吸附' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Road',
    description: 'A flat road segment with editable width, lane count, and markings.',
    icon: { kind: 'url', src: '/icons/road.svg' },
    paletteSection: 'structure',
    paletteOrder: 19,
  },

  mcp: {
    description: 'A road segment defined by start + end points, width, and lane markings.',
  },
}

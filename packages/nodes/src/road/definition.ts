import type { NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import {
  nudgeSegmentPlan,
  routeEndpointLabel,
  segmentEndpointLocalPosition,
} from '../shared/route-edit-actions'
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
    surfaceKind: 'road',
    start: [0, 0],
    end: [5, 0],
    curveOffset: 0,
    width: 3.5,
    thickness: 0.04,
    elevation: 0.01,
    laneCount: 2,
    showLaneMarkings: true,
    material: {
      preset: 'custom',
      properties: {
        color: '#2f3338',
        roughness: 0.88,
        metalness: 0.02,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
    },
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

  materialTargets: overallMaterialTarget,

  tool: () => import('./tool'),

  geometry: buildRoadGeometry,
  floorplan: buildRoadFloorplan,

  affordanceTools: {
    curve: () => import('./curve-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  editActions: {
    nudgePlan: nudgeSegmentPlan,
  },

  actionMenu: {
    placement: 'linear',
    curve: {},
    endpointMove: {
      label: (endpoint, ctx) => routeEndpointLabel('Road', 'road', endpoint, ctx),
      localPosition: segmentEndpointLocalPosition,
    },
  },

  toolHints: [
    {
      key: 'Left click',
      label: '\u8bbe\u7f6e\u5730\u9762\u5e26\u8d77\u70b9 / \u7ec8\u70b9',
    },
    { key: 'Shift', label: '按住关闭角度吸附' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: '\u5730\u9762\u5e26',
    description: 'A flat ground strip that can act as a road, river, walkway, or greenbelt.',
    icon: { kind: 'url', src: '/icons/road.svg' },
    paletteSection: 'structure',
    paletteOrder: 19,
  },

  mcp: {
    description: 'A ground strip defined by start + end points, width, surface kind, and markings.',
  },
}

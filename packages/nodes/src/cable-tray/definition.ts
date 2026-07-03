import type { NodeDefinition } from '@pascal-app/core'
import {
  nudgeSegmentPlan,
  routeEndpointLabel,
  segmentEndpointLocalPosition,
} from '../shared/route-edit-actions'
import { buildCableTrayFloorplan } from './floorplan'
import { buildCableTrayGeometry } from './geometry'
import { cableTrayParametrics } from './parametrics'
import { CableTrayNode } from './schema'

export const cableTrayDefinition: NodeDefinition<typeof CableTrayNode> = {
  kind: 'cable-tray',
  schemaVersion: 1,
  schema: CableTrayNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    curveOffset: 0,
    width: 0.45,
    sideHeight: 0.18,
    thickness: 0.035,
    elevation: 2.4,
    rungSpacing: 0.35,
    showRungs: true,
    color: '#9aa3ad',
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

  parametrics: cableTrayParametrics,
  tool: () => import('./tool'),
  geometry: buildCableTrayGeometry,
  floorplan: buildCableTrayFloorplan,

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
      label: (endpoint, ctx) => routeEndpointLabel('CableTray', 'cable tray', endpoint, ctx),
      localPosition: segmentEndpointLocalPosition,
    },
  },

  toolHints: [
    { key: 'Left click', label: '设置桥架起点 / 终点' },
    { key: 'Shift', label: '按住关闭角度吸附' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Cable Tray',
    description:
      'An editable industrial cable tray route with width, elevation, and rung controls.',
    icon: { kind: 'url', src: '/icons/pipe.svg' },
    paletteSection: 'structure',
    paletteOrder: 21,
  },

  mcp: {
    description:
      'Cable tray route defined by start/end points, width, side height, elevation, and rung spacing.',
  },
}

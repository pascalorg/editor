import {
  buildDynamicCapabilityMetadata,
  type ConveyorBeltNode as ConveyorBeltNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildConveyorBeltFloorplan } from './floorplan'
import { conveyorBeltMoveEndpointAffordance } from './floorplan-affordances'
import { buildConveyorBeltGeometry } from './geometry'
import { conveyorBeltParametrics } from './parametrics'
import { ConveyorBeltNode } from './schema'

function endpointHandle(endpoint: 'start' | 'end'): HandleDescriptor<ConveyorBeltNodeType> {
  return {
    kind: 'tap-action',
    shape: 'corner-picker',
    cursor: 'move',
    nodeHeight: (node) => node.elevation + node.thickness + 0.24,
    onActivate: (node, _scene, editor) => editor.engageEndpointMove(node, endpoint),
    placement: {
      position: (node) => {
        const point = endpoint === 'start' ? node.points[0] : node.points[node.points.length - 1]
        return [point?.[0] ?? 0, node.elevation + node.thickness + 0.2, point?.[2] ?? 0]
      },
    },
  }
}

export const conveyorBeltDefinition: NodeDefinition<typeof ConveyorBeltNode> = {
  kind: 'conveyor-belt',
  schemaVersion: 1,
  schema: ConveyorBeltNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {
      semanticType: 'conveyor',
      dynamicCapabilities: buildDynamicCapabilityMetadata('conveyor', 'builtin-node'),
    },
    points: [
      [0, 0, 0],
      [4, 0, 0],
    ],
    width: 0.8,
    thickness: 0.08,
    elevation: 0.8,
    color: '#111827',
    edgeColor: '#94a3b8',
    rollerColor: '#cbd5e1',
    showFrame: true,
    showRollers: true,
    rollerSpacing: 1,
    direction: 'forward',
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

  parametrics: conveyorBeltParametrics,
  tool: () => import('./tool'),
  geometry: buildConveyorBeltGeometry,
  floorplan: buildConveyorBeltFloorplan,
  floorplanAffordances: {
    'move-endpoint': conveyorBeltMoveEndpointAffordance,
  },
  handles: [endpointHandle('start'), endpointHandle('end')],
  affordanceTools: {
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  toolHints: [
    { key: 'Left click', label: '\u6dfb\u52a0\u8def\u5f84\u70b9' },
    { key: 'Enter / Double click', label: '\u5b8c\u6210\u8f93\u9001\u5e26' },
    { key: 'Backspace', label: '\u64a4\u9500\u4e0a\u4e00\u4e2a\u70b9' },
    { key: 'Shift', label: '\u5173\u95ed\u89d2\u5ea6\u5438\u9644' },
    { key: 'Esc', label: '\u7ed3\u675f\u653e\u7f6e' },
  ],

  presentation: {
    label: '\u8f93\u9001\u5e26',
    description: 'A multi-segment conveyor route for preview-time cargo flow.',
    icon: { kind: 'url', src: '/icons/pipe.svg' },
    paletteSection: 'structure',
    paletteOrder: 20,
  },

  mcp: {
    description:
      'Conveyor belt route defined by multiple centerline points, width, elevation, rollers, and flow direction.',
  },
}

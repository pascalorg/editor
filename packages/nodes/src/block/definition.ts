import {
  type BlockNode as BlockNodeType,
  blockBounds,
  blockFloorPlaced,
  createBoxBlockTopology,
  type NodeDefinition,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { blockContextualHelp } from './contextual-help'
import { blockFaceHost } from './face-host'
import { buildBlockFloorplan } from './floorplan'
import { buildBlockGeometry } from './geometry'
import { blockPaint } from './paint'
import { blockParametrics } from './parametrics'
import { BlockNode } from './schema'
import { blockSlots } from './slots'
import { blockSurfaceProvider } from './surface'

export const blockDefinition: NodeDefinition<typeof BlockNode> = {
  kind: 'block',
  schemaVersion: 5,
  schema: BlockNode,
  category: 'structure',
  surfaceRole: 'wall',
  snapProfile: 'structural',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./tool'),
      preferredView: '3d',
    } satisfies FloorplanNodeExtension<BlockNodeType>,
    'pascal:editor/contextual-help': blockContextualHelp,
  },

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: 0,
    topology: createBoxBlockTopology(),
    slots: {},
    slotNames: { body: 'Body' },
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      hosting: blockSurfaceProvider,
      top: {
        height: (rawNode) => {
          const node = rawNode as BlockNodeType
          const { size, center } = blockBounds(node)
          return center[1] + size[1] / 2
        },
      },
      sides: { faces: 'all' },
    },
    movable: { axes: ['x', 'z'], gridSnap: true },
    duplicable: { subtree: true },
    deletable: true,
    dragBounds: (rawNode) => blockBounds(rawNode as BlockNodeType),
    floorPlaced: blockFloorPlaced,
    paint: blockPaint,
    slots: (rawNode) => blockSlots(rawNode as BlockNodeType),
    faceHost: blockFaceHost,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  geometry: buildBlockGeometry,
  geometryChildTypes: [],
  geometryKey: (node) => JSON.stringify([node.topology, node.slots]),
  floorplan: buildBlockFloorplan,
  parametrics: blockParametrics,
  affordanceTools: {
    selection: () => import('./selection'),
  },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place block' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Block',
    description: 'A topology-backed solid edited directly in the canvas.',
    icon: { kind: 'url', src: '/icons/cube.webp' },
    paletteSection: 'structure',
    paletteOrder: 75,
    actionMenu: false,
  },
  mcp: {
    description:
      'An editable block solid with persistent vertex, edge, and face topology. Positions are level-local meters.',
  },
}

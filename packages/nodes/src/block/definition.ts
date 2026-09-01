import {
  type BlockNode as BlockNodeType,
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

export function blockBounds(node: BlockNodeType) {
  const xs = node.topology.vertices.map((vertex) => vertex.position[0])
  const ys = node.topology.vertices.map((vertex) => vertex.position[1])
  const zs = node.topology.vertices.map((vertex) => vertex.position[2])
  if (xs.length === 0) {
    return {
      size: [0, 0, 0] as [number, number, number],
      center: [0, 0, 0] as [number, number, number],
    }
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return {
    size: [maxX - minX, maxY - minY, maxZ - minZ] as [number, number, number],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as [number, number, number],
  }
}

function footprintPosition(node: BlockNodeType, center: [number, number, number]) {
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  return [
    node.position[0] + center[0] * cos + center[2] * sin,
    node.position[1],
    node.position[2] - center[0] * sin + center[2] * cos,
  ] as [number, number, number]
}

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
    duplicable: true,
    deletable: true,
    dragBounds: (rawNode) => blockBounds(rawNode as BlockNodeType),
    floorPlaced: {
      footprint: (rawNode) => {
        const node = rawNode as BlockNodeType
        const { size, center } = blockBounds(node)
        return {
          dimensions: size,
          position: footprintPosition(node, center),
          rotation: [0, node.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
    paint: blockPaint,
    slots: (rawNode) => blockSlots(rawNode as BlockNodeType),
    faceHost: blockFaceHost,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  geometry: buildBlockGeometry,
  geometryKey: (node) => JSON.stringify([node.topology, node.slots]),
  floorplan: buildBlockFloorplan,
  parametrics: blockParametrics,
  affordanceTools: {
    selection: () => import('./selection'),
  },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place block', labelKey: 'nodes.block.toolHints.place' },
    { key: 'Esc', label: 'Cancel', labelKey: 'common.cancel' },
  ],
  presentation: {
    label: 'Block',
    labelKey: 'panel.nodeType.block',
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

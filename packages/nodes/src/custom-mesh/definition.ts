import {
  type CustomMeshNode as CustomMeshNodeType,
  createBoxCustomMeshTopology,
  type NodeDefinition,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildCustomMeshFloorplan } from './floorplan'
import { buildCustomMeshGeometry } from './geometry'
import { CustomMeshNode } from './schema'

function bounds(node: CustomMeshNodeType) {
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

function footprintPosition(node: CustomMeshNodeType, center: [number, number, number]) {
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  return [
    node.position[0] + center[0] * cos + center[2] * sin,
    node.position[1],
    node.position[2] - center[0] * sin + center[2] * cos,
  ] as [number, number, number]
}

export const customMeshDefinition: NodeDefinition<typeof CustomMeshNode> = {
  kind: 'custom-mesh',
  schemaVersion: 1,
  schema: CustomMeshNode,
  category: 'structure',
  surfaceRole: 'wall',
  snapProfile: 'item',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./tool'),
      preferredView: '3d',
    } satisfies FloorplanNodeExtension<CustomMeshNodeType>,
  },

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    topology: createBoxCustomMeshTopology(),
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    duplicable: true,
    deletable: true,
    dragBounds: (rawNode) => bounds(rawNode as CustomMeshNodeType),
    floorPlaced: {
      footprint: (rawNode) => {
        const node = rawNode as CustomMeshNodeType
        const { size, center } = bounds(node)
        return {
          dimensions: size,
          position: footprintPosition(node, center),
          rotation: [0, node.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
  },

  geometry: buildCustomMeshGeometry,
  geometryKey: (node) => JSON.stringify([node.topology, node.slots]),
  floorplan: buildCustomMeshFloorplan,
  affordanceTools: {
    selection: () => import('./selection'),
  },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place custom mesh' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Custom Mesh',
    description: 'A topology-backed solid edited directly in the canvas.',
    icon: { kind: 'iconify', name: 'lucide:box-select' },
    paletteSection: 'structure',
    paletteOrder: 75,
    actionMenu: false,
  },
  mcp: {
    description:
      'A custom editable solid with persistent vertex, edge, and face topology. Positions are level-local meters.',
  },
}

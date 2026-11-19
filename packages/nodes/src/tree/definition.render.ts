import { TreeNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildTreeFloorplan } from './floorplan'
import { buildTreeGeometry } from './geometry'
import { isTreePositionAllowed } from './movement'

export const treeRenderDefinition: NodeRenderDefinition<typeof TreeNode> & { kind: 'tree' } = {
  kind: 'tree',
  extensions: { 'pascal:viewer': { family: 'site' } },
  schemaVersion: 1,
  schema: TreeNode,
  category: 'site',
  defaults: () => {
    const { id: _id, type: _type, ...defaults } = TreeNode.parse({ id: 'tree_default' })
    return defaults
  },
  capabilities: {
    exterior: true,
    revealOnEdit: ['position', 'form', 'heightM', 'spreadM', 'foliage', 'density', 'seed'],
    drawTool: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      resolvePosition: ({ position }) => [position[0], 0, position[2]],
      isValidPosition: ({ node, position, nodes }) =>
        node.type === 'tree' && isTreePositionAllowed(node, position, nodes),
    },
    selectable: { hitVolume: 'mesh' },
    deletable: true,
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  geometry: buildTreeGeometry,
  geometryChildTypes: [],
  floorplan: buildTreeFloorplan,
  floorplanScope: 'site',
  sitePlan: true,
  system: { module: () => import('./system') },
  presentation: {
    label: 'Tree',
    description: 'A seeded garden tree, rooted on the Site ground.',
    icon: { kind: 'url', src: '/icons/garden-tree.webp' },
    paletteSection: 'structure',
    paletteOrder: 81,
  },
  mcp: {
    description:
      'A procedural Site tree: form, height and crown spread in metres, foliage colour, density and seed. Position is Site XZ with stored Y=0; its base follows the ground.',
  },
}

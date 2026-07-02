import type { NodeDefinition } from '@pascal-app/core'
import { buildFlowerFloorplan } from './floorplan'
import { flowerParametrics } from './flower-parametrics'
import { FlowerNode } from './flower-schema'

/**
 * The flower node definition — a sibling instanced kind to the tree. Same
 * composition: a `def.system` batches every flower into InstancedMeshes, a
 * featherweight `def.renderer` proxy keeps selection working, `parametrics`
 * gives the inspector, `tool`/`preview` drive placement.
 */
export const flowerDefinition: NodeDefinition<typeof FlowerNode> = {
  kind: 'trees:flower',
  bake: 'replace', // static in bake, live-rebuilt in our viewer — see plans → Part D
  schemaVersion: 1,
  schema: FlowerNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    preset: 'daisy',
    height: 0.5,
    seed: 1,
    petalColor: '#fcfcf2',
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4),
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    snappable: {},
    floorPlaced: {
      footprint: (node) => {
        const flower = node as unknown as FlowerNode
        const radius = Math.max(0.1, flower.height * 0.25)
        return {
          dimensions: [radius * 2, flower.height, radius * 2] as [number, number, number],
          rotation: flower.rotation,
        }
      },
      collides: false,
    },
  },

  parametrics: flowerParametrics,
  floorplan: buildFlowerFloorplan,

  renderer: { kind: 'parametric', module: () => import('./flower-proxy-renderer') },
  system: { module: () => import('./flower-system'), priority: 3 },
  bakeReplaceRenderer: { module: () => import('./flower-static-renderer') },

  preview: () => import('./flower-preview'),
  tool: () => import('./flower-tool'),
  toolHints: [
    { key: 'Left click', label: 'Plant flower' },
    { key: 'Esc', label: 'Stop' },
  ],

  presentation: {
    label: 'Flower',
    description: 'A procedural flower. Daisy, tulip, or lavender.',
    icon: { kind: 'iconify', name: 'lucide:flower-2' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A procedural flower (example plugin node) — daisy, tulip, or lavender, instanced like the trees.',
  },
}

import type { NodeDefinition } from '@pascal-app/core'
import { buildGrassFloorplan } from './floorplan'
import { grassParametrics } from './grass-parametrics'
import { GrassNode } from './grass-schema'

/**
 * The grass node definition — a third instanced kind alongside trees & flowers.
 * Same composition: a `def.system` batches every tuft into InstancedMeshes, a
 * featherweight `def.renderer` proxy keeps selection working, `parametrics`
 * gives the inspector, `tool`/`preview` drive placement.
 */
export const grassDefinition: NodeDefinition<typeof GrassNode> = {
  kind: 'trees:grass',
  bake: 'replace', // static in bake, live-rebuilt in our viewer — see plans → Part D
  schemaVersion: 1,
  schema: GrassNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    preset: 'meadow',
    height: 0.4,
    seed: 1,
    bladeColor: '#5a8f3c',
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
        const grass = node as unknown as GrassNode
        const radius = Math.max(0.1, grass.height * 0.3)
        return {
          dimensions: [radius * 2, grass.height, radius * 2] as [number, number, number],
          rotation: grass.rotation,
        }
      },
      collides: false,
    },
  },

  parametrics: grassParametrics,
  floorplan: buildGrassFloorplan,

  renderer: { kind: 'parametric', module: () => import('./grass-proxy-renderer') },
  system: { module: () => import('./grass-system'), priority: 3 },
  bakeReplaceRenderer: { module: () => import('./grass-static-renderer') },

  preview: () => import('./grass-preview'),
  tool: () => import('./grass-tool'),
  toolHints: [
    { key: 'Left click', label: 'Plant grass' },
    { key: 'Esc', label: 'Stop' },
  ],

  presentation: {
    label: 'Grass',
    description: 'A procedural grass tuft. Meadow, fescue, or reed.',
    icon: { kind: 'iconify', name: 'lucide:wheat' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A procedural grass tuft (example plugin node) — meadow, fescue, or reed, instanced like the trees.',
  },
}

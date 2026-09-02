import type { NodeDefinition } from '@pascal-app/core'
import { lumberBoxDims } from './lumber'
import { lumberParametrics } from './parametrics'
import { LumberNode } from './schema'

type LumberDefinition = NodeDefinition<typeof LumberNode> & Record<string, unknown>

const lumberFloorPlacement = {
  footprint: (node: unknown) => {
    const member = node as LumberNode
    return {
      dimensions: lumberBoxDims(member.size, member.length, member.orientation),
      rotation: member.rotation,
    }
  },
  collides: false,
}

/**
 * The loose lumber member definition — the Bones plugin's first kind. A plain
 * per-node parametric renderer (no instancing yet; framing inference will
 * batch into InstancedMeshes — see SPEC.md). `parametrics` gives the inspector
 * for free; `tool`/`preview` drive placement. No host dispatch code per kind.
 */
export const lumberDefinition: LumberDefinition = {
  kind: 'bones:lumber',
  schemaVersion: 1,
  schema: LumberNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: '2x4',
    length: 2.4384,
    orientation: 'stud',
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
    dragBounds: (node) => {
      const member = node as unknown as LumberNode
      return { size: lumberBoxDims(member.size, member.length, member.orientation) }
    },
    floorPlaced: lumberFloorPlacement,
  },

  parametrics: lumberParametrics,

  renderer: { kind: 'parametric', module: () => import('./renderer') },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place member' },
    { key: 'Esc', label: 'Stop' },
  ],

  presentation: {
    label: 'Lumber',
    description: 'A piece of dimensional lumber at actual dressed size (2x4 … 6x6).',
    icon: { kind: 'iconify', name: 'lucide:hammer' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A loose dimensional lumber member (Bones framing plugin). Nominal size (2x4/2x6/2x8/2x10/2x12/4x4/4x6/6x6) rendered at actual dressed dimensions, length in meters, orientation stud (vertical) / flat (plate-like) / edge (joist-like).',
  },
}

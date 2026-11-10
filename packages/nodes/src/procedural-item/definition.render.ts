import { getEffectiveNode, proceduralItemSlots } from '@pascal-app/core'

import {
  evaluateRecipe,
  ProceduralItemNode,
  proceduralCeilingHole,
  proceduralFootprint,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
import type { NodeRenderDefinition } from '../definition-contributions'
import { proceduralMechanism } from '../shared/item-interactions'
import { bakeProceduralAnimationClips, isProceduralMotionPlaying } from './animation'

export const proceduralItemRenderDefinition: NodeRenderDefinition<typeof ProceduralItemNode> & {
  kind: 'procedural-item'
} = {
  kind: 'procedural-item',
  schemaVersion: 1,
  schema: ProceduralItemNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    recipe: shelfRecipe,
    parameters: {},
    slots: {},
    children: [],
    attachments: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  }),
  capabilities: {
    reveal: { phase: 'furnishing', style: 'drop', height: 0.3 },
    revealOnEdit: ['recipe'],
    batchable: {
      scope: 'level',
      // Part lights clone their emissive slot per node, and a playing motion
      // moves meshes under the static copy.
      excluded: (n) =>
        (n as unknown as ProceduralItemNode).recipe.parts.some((part) => part.light) ||
        isProceduralMotionPlaying(n.id),
    },
    selectable: { hitVolume: 'bbox' },
    mechanism: proceduralMechanism,
    dragBounds: (n) => {
      const node = n as unknown as ProceduralItemNode
      const e = evaluateRecipe(node.recipe, node.parameters)
      return {
        size: e.dimensions,
        center: e.min.map((v, i) => (v + e.max[i]!) / 2) as [number, number, number],
      }
    },
    hostable: {
      parents: ['level', 'wall', 'ceiling', 'procedural-item', 'item', 'shelf'],
      align: 'face',
    },
    hostRefFields: ['wallId', 'side', 'supportSlabId'],
    ceilingCut: {
      buildCeilingHole: (n) => {
        const node = getEffectiveNode(n as unknown as ProceduralItemNode)
        return node.visible === false ? null : proceduralCeilingHole(node)
      },
    },
    floorPlaced: {
      footprint: (n) => proceduralFootprint(n as unknown as ProceduralItemNode),
      applies: (n) => !(n as unknown as ProceduralItemNode).recipe.mounting,
      collides: true,
    },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 4, Math.PI / 2, Math.PI] },
    duplicable: { subtree: 'with-children' },
    deletable: true,
    slots: (n) => proceduralItemSlots(n as unknown as ProceduralItemNode),
    surfaces: {
      custom: (n) =>
        evaluateRecipe(
          (n as unknown as ProceduralItemNode).recipe,
          (n as unknown as ProceduralItemNode).parameters,
        ).surfaces.map((s) => ({
          id: s.id,
          position: s.position,
          normal: s.normal,
          rotation: s.rotation,
          size: s.size,
        })),
    },
  },
  relations: { hosts: ['item', 'procedural-item'], cascadeDelete: 'descendants' },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  exportAnimation: ({ node, object }) => bakeProceduralAnimationClips(node, object),
  presentation: {
    label: 'Procedural item',
    description: 'Experimental editable recipe',
    icon: { kind: 'iconify', name: 'lucide:boxes' },
  },
  mcp: { description: 'Experimental procedural item with a validated recipe.' },
}

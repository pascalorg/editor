import {
  type AnyNode,
  type NodeDefinition,
  type RoofSegmentNode,
  SkylightNode as SkylightNodeSchema,
  type SkylightNode as SkylightNodeType,
} from '@pascal-app/core'
import {
  closeSkylightOpenState,
  isOperableSkylightNode,
  toggleSkylightOpenState,
} from './interaction'
import { skylightParametrics } from './parametrics'
import { buildSkylightRoofCut } from './roof-cut'
import { SkylightNode } from './schema'

/**
 * Skylight — a framed glass opening hosted on a roof segment. All five
 * type variants (flat / walk-on / lantern / opening / sliding) render
 * with the archive's full geometry; the animation system advances
 * `operationState` via `useInteractive.skylightAnimations`.
 */
export const skylightDefinition: NodeDefinition<typeof SkylightNode> = {
  kind: 'skylight',
  schemaVersion: 1,
  schema: SkylightNode,
  category: 'structure',
  surfaceRole: 'glazing',

  defaults: () => {
    const stub = SkylightNodeSchema.parse({
      id: 'skylight_default' as never,
      type: 'skylight',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Dirty marks
    // cascade to the host segment's parent roof so its merged shell
    // re-CSGs with the new cut. `buildCut` returns the segment-local
    // box that's subtracted from shin / deck / wall.
    roofAccessory: {
      buildCut: (node: AnyNode, hostSegment: AnyNode) =>
        buildSkylightRoofCut(node as SkylightNodeType, hostSegment as RoofSegmentNode),
    },
  },

  parametrics: skylightParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },

  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place skylight on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Skylight',
    description: 'Framed glass opening on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 124,
  },

  mcp: {
    description:
      'A skylight on a roof segment. Five type variants (flat / walk-on / lantern / opening / sliding) — geometry beyond box stub coming later.',
  },

  // R toggles open ↔ closed on operable types (opening / sliding); T
  // forces close. The animation runs through `useInteractive` and the
  // skylight system; see `./interaction.ts`.
  keyboardActions: {
    r: {
      appliesTo: (node: AnyNode) =>
        node.type === 'skylight' && isOperableSkylightNode(node as SkylightNodeType),
      run: (node: AnyNode) => toggleSkylightOpenState(node.id),
    },
    t: {
      appliesTo: (node: AnyNode) =>
        node.type === 'skylight' && isOperableSkylightNode(node as SkylightNodeType),
      run: (node: AnyNode) => closeSkylightOpenState(node.id),
    },
  },
}

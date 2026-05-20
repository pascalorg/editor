import { type NodeDefinition, SkylightNode as SkylightNodeSchema } from '@pascal-app/core'
import { skylightParametrics } from './parametrics'
import { SkylightNode } from './schema'

/**
 * Skylight — a framed glass opening hosted on a roof segment.
 *
 * **Scope of this port — stub.** Schema is complete (all 25 fields from
 * the archive carry through, including the type-specific variants and
 * the animation state fields). Geometry renders frame + glass as
 * boxes for ALL types — the lantern slope, opening swing, and sliding
 * panel offset from the archive are NOT yet rebuilt. Animation
 * (open/close interpolation driven by `useInteractive.skylight
 * Animations`) is also not rebuilt — `operationState` and
 * `slideFraction` round-trip via the inspector as static knobs.
 *
 * Three-checkbox model: custom `def.renderer`, no `geometry` field
 * (the builder lives in `./geometry` and is shared), no `def.system`
 * (animation comes back when `useInteractive` gains the skylight
 * animation surface).
 */
export const skylightDefinition: NodeDefinition<typeof SkylightNode> = {
  kind: 'skylight',
  schemaVersion: 1,
  schema: SkylightNode,
  category: 'structure',

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
  },

  parametrics: skylightParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
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
}

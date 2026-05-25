import { type NodeDefinition, StairNode as StairNodeSchema } from '@pascal-app/core'
import { buildStairFloorplan } from './floorplan'
import { stairFloorplanMoveTarget } from './floorplan-move'
import { stairParametrics } from './parametrics'
import { StairNode } from './schema'

/**
 * Stair — Stage A. Composite node like roof: owns overall framing,
 * `stair-segment` children own per-flight geometry. Wrap-exports the
 * legacy `StairRenderer` + `StairSystem`.
 */
export const stairDefinition: NodeDefinition<typeof StairNode> = {
  kind: 'stair',
  schemaVersion: 1,
  schema: StairNode,
  category: 'structure',
  surfaceRole: 'joinery',

  defaults: () => {
    const stub = StairNodeSchema.parse({ id: 'stair_default' as never, type: 'stair' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: stairParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  // Stage C — stair is the parent; it walks its `stair-segment` children
  // via `ctx.children` and emits the whole stack as one registry entry.
  // Each flight's transform depends on every prior sibling's
  // `length` / `height` / `attachmentSide`, so individual segments can't
  // compute their own polygon in isolation. See
  // `nodes/src/stair/floorplan.ts` for the emitter.
  floorplan: buildStairFloorplan,
  floorplanMoveTarget: stairFloorplanMoveTarget,

  presentation: {
    label: 'Stair',
    description:
      'A stair composed of one or more flights with configurable treads, risers, railings.',
    icon: { kind: 'url', src: '/icons/stairs.png' },
    paletteSection: 'structure',
    paletteOrder: 110,
  },

  mcp: {
    description: 'A multi-flight stair with segmented geometry.',
  },
}

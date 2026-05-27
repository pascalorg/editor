import { type NodeDefinition, RidgeVentNode as RidgeVentNodeSchema } from '@pascal-app/core'
import { ridgeVentParametrics } from './parametrics'
import { RidgeVentNode } from './schema'

/**
 * Ridge vent — a ventilation strip running along the ridge of a roof
 * segment. Parented to a `roof-segment`; position is segment-local.
 *
 * Three-checkbox model — same shape as box-vent: custom `def.renderer`
 * (parent segment transform lookup + live-transform follow), pure
 * geometry builder shared with the placement preview + future tests,
 * no animation or per-frame system.
 *
 * The placement tool snaps to the ridge (segment-local Z=0) wherever
 * the cursor lands on a segment.
 */
export const ridgeVentDefinition: NodeDefinition<typeof RidgeVentNode> = {
  kind: 'ridge-vent',
  schemaVersion: 1,
  schema: RidgeVentNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = RidgeVentNodeSchema.parse({
      id: 'rvent_default' as never,
      type: 'ridge-vent',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // ridge — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },

  parametrics: ridgeVentParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place ridge vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Ridge Vent',
    description: 'Ventilation strip running along the ridge of a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 121,
  },

  mcp: {
    description:
      'A ridge vent — three styles (standard curved cap / shingled / metal), optional end caps, length / width / height parametric.',
  },
}

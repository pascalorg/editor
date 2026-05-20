import { type NodeDefinition, SolarPanelNode as SolarPanelNodeSchema } from '@pascal-app/core'
import { solarPanelParametrics } from './parametrics'
import { SolarPanelNode } from './schema'

/**
 * Solar panel array — a grid of photovoltaic panels mounted on a roof
 * segment. Position is segment-local; the surface normal stored on
 * the node orients the array flat to the slope.
 *
 * Three-checkbox model: custom `def.renderer` for the parent-segment
 * lookup + analytical surface normal fallback. No `geometry` (the
 * builder lives in `./geometry` and is shared with the preview), no
 * `system` (the orientation quaternion is computed once per render,
 * not per frame — see renderer notes).
 */
export const solarPanelDefinition: NodeDefinition<typeof SolarPanelNode> = {
  kind: 'solar-panel',
  schemaVersion: 1,
  schema: SolarPanelNode,
  category: 'structure',

  defaults: () => {
    const stub = SolarPanelNodeSchema.parse({
      id: 'solarpanel_default' as never,
      type: 'solar-panel',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: solarPanelParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place solar panel array on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Solar Panel',
    description: 'Grid of photovoltaic panels mounted on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },

  mcp: {
    description:
      'A solar panel array on a roof segment. rows × columns grid of individual panels with configurable size, gap, mounting (flush / tilted), and frame.',
  },
}

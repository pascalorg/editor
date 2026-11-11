import { SolarPanelNode as SolarPanelNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildSolarPanelFloorplan } from './floorplan'
import { SolarPanelNode } from './schema'

export const solarPanelRenderDefinition: NodeRenderDefinition<typeof SolarPanelNode> & {
  kind: 'solar-panel'
} = {
  kind: 'solar-panel',
  schemaVersion: 1,
  schema: SolarPanelNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = SolarPanelNodeSchema.parse({
      id: 'solarpanel_default' as never,
      type: 'solar-panel',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // shell — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the array moves / resizes.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildSolarPanelFloorplan,
  presentation: {
    label: 'Solar Panel',
    description: 'Grid of photovoltaic panels mounted on a roof segment.',
    icon: { kind: 'url', src: '/icons/solar-panel.webp' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },
  mcp: {
    description:
      'A solar panel array on a roof segment. rows × columns grid of individual panels with configurable size, gap, mounting (flush / tilted), and frame.',
  },
}

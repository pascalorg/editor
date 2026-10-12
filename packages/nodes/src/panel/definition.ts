import type { NodeDefinition } from '@pascal-app/core'
import { buildPanelFloorplan } from './floorplan'
import { buildPanelGeometry } from './geometry'
import { panelPaint } from './paint'
import { panelParametrics } from './parametrics'
import { PanelNode } from './schema'
import { panelSlots } from './slots'

/**
 * Panel — flat cladding hosted on one wall face: an infill beside a window, a
 * spandrel below it, a pier or base cladding. Surface, not structure: the
 * wall never cuts for it. Facade bays generate panels; they can also be
 * placed and edited on their own.
 */
export const panelDefinition: NodeDefinition<typeof PanelNode> = {
  kind: 'panel',
  schemaVersion: 1,
  schema: PanelNode,
  category: 'structure',
  surfaceRole: 'wall',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...rest
    } = PanelNode.parse({ id: 'panel_default', type: 'panel' })
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'mesh' },
    duplicable: true,
    deletable: true,
    // The host wall is re-derived from the surface under the cursor when placed from a preset.
    hostRefFields: ['wallId'],
    slots: () => panelSlots(),
    paint: panelPaint,
  },
  parametrics: panelParametrics,
  geometry: buildPanelGeometry,
  geometryChildTypes: [],
  system: { module: () => import('./system') },
  floorplan: buildPanelFloorplan,
  presentation: {
    label: 'Panel',
    description:
      'Flat cladding on a wall face: infill beside a window, a spandrel below it, pier or base cladding.',
    icon: { kind: 'url', src: '/icons/panel.svg' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'A flat cladding panel fixed to one face of a wall, with its own material.',
  },
}

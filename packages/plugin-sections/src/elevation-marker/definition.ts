import type { NodeDefinition } from '@pascal-app/core'
import { ElevationMarkerNode } from '../schema'
import { buildElevationMarkerFloorplan } from './floorplan'

/**
 * `elevation-marker` — names one exterior elevation. `buildElevationDrawing`
 * turns it into a true vector elevation of the building.
 */
export const elevationMarkerDefinition: NodeDefinition<typeof ElevationMarkerNode> = {
  kind: 'elevation-marker',
  schemaVersion: 1,
  schema: ElevationMarkerNode,
  category: 'analysis',
  bake: 'strip',
  dirtyTracking: false,
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      preferredView: '2d',
    },
  },
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    label: '1',
    direction: 'north',
    angle: Math.PI / 2,
    position: [0, 0],
    sheetRef: null,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
  },
  parametrics: {
    groups: [
      {
        label: 'Elevation',
        fields: [
          {
            key: 'direction',
            kind: 'enum',
            options: ['north', 'east', 'south', 'west', 'custom'],
          },
          {
            key: 'angle',
            label: 'View azimuth',
            kind: 'number',
            unit: 'rad',
            min: -Math.PI,
            max: Math.PI,
            step: 0.01,
            visibleIf: (node) => node.direction === 'custom',
          },
        ],
      },
    ],
  },
  floorplan: buildElevationMarkerFloorplan,
  presentation: {
    label: 'Elevation marker',
    description:
      'Names one exterior elevation of the building. Drives a true vector elevation drawn from the scene geometry.',
    icon: { kind: 'iconify', name: 'lucide:panel-top' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      'An exterior elevation marker. direction is north | east | south | west | custom; when custom, angle is the view azimuth in radians measured in the XZ plane from +x toward +z (north = PI/2, east = PI, south = -PI/2, west = 0). position is the plan position of the glyph [x, z] metres.',
  },
}

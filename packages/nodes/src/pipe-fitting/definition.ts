import type { NodeDefinition } from '@pascal-app/core'
import { buildPipeFittingFloorplan } from './floorplan'
import { buildPipeFittingGeometry } from './geometry'
import { pipeFittingParametrics } from './parametrics'
import { getPipeFittingPorts } from './ports'
import { PipeFittingNode } from './schema'

/**
 * DWV fittings — minted automatically by the pipe draw tool (corner
 * joints → elbows, body taps → wyes on horizontal drains / sanitary
 * tees on stacks). No placement tool of its own: unlike duct fittings,
 * a loose DWV fitting on the floor isn't a real workflow. Editable
 * after the fact via the inspector.
 */
export const pipeFittingDefinition: NodeDefinition<typeof PipeFittingNode> = {
  kind: 'pipe-fitting',
  schemaVersion: 1,
  schema: PipeFittingNode,
  category: 'utility',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    fittingType: 'elbow',
    angle: 90,
    diameter: 2,
    diameter2: 2,
    pipeMaterial: 'pvc',
    system: 'waste',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true, cursorAttached: true },
    duplicable: true,
    deletable: true,
  },

  parametrics: pipeFittingParametrics,

  geometry: buildPipeFittingGeometry,
  geometryKey: (n) =>
    JSON.stringify([n.fittingType, n.angle, n.diameter, n.diameter2, n.pipeMaterial, n.system]),

  ports: getPipeFittingPorts,

  floorplan: buildPipeFittingFloorplan,

  presentation: {
    label: 'Pipe Fitting',
    description: 'DWV joint — elbow bend, 45° wye, or sanitary tee.',
    icon: { kind: 'iconify', name: 'lucide:git-merge' },
    paletteSection: 'structure',
    paletteOrder: 96,
    hidden: true,
  },

  mcp: {
    description:
      'A DWV pipe fitting (elbow, wye, or sanitary tee) with typed ports. Minted automatically at drain joints; position is level-local meters, rotation an XYZ euler.',
  },
}

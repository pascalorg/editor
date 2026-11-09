import type { NodeRenderDefinition } from '../definition-contributions'
import { buildPipeFittingGeometry } from './geometry'
import { getPipeFittingPorts } from './ports'
import { PipeFittingNode } from './schema'

export const pipeFittingRenderDefinition: NodeRenderDefinition<typeof PipeFittingNode> & {
  kind: 'pipe-fitting'
} = {
  kind: 'pipe-fitting',
  schemaVersion: 2,
  schema: PipeFittingNode,
  category: 'utility',
  distributionRole: 'fitting',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    cleanoutStyle: 'end',
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
  geometry: buildPipeFittingGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.fittingType,
      n.cleanoutStyle,
      n.angle,
      n.diameter,
      n.diameter2,
      n.pipeMaterial,
      n.system,
    ]),
  ports: getPipeFittingPorts,
  presentation: {
    label: 'Pipe Fitting',
    description: 'DWV joint — elbow bend, 45° wye, or sanitary tee.',
    // Reuses the duct-fitting artwork — DWV fittings read the same in the UI.
    icon: { kind: 'url', src: '/icons/duct-fitting.webp' },
    paletteSection: 'structure',
    paletteOrder: 96,
    hidden: true,
  },
  mcp: {
    description:
      'A DWV pipe fitting (elbow, wye, or sanitary tee) with typed ports. Minted automatically at drain joints; position is level-local meters, rotation an XYZ euler.',
  },
}

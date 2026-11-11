import type { NodeRenderDefinition } from '../definition-contributions'
import { buildPipeTrapFloorplan } from './floorplan'
import { buildPipeTrapGeometry } from './geometry'
import { getPipeTrapPorts } from './ports'
import { PipeTrapNode } from './schema'

export const pipeTrapRenderDefinition: NodeRenderDefinition<typeof PipeTrapNode> & {
  kind: 'pipe-trap'
} = {
  kind: 'pipe-trap',
  schemaVersion: 1,
  schema: PipeTrapNode,
  category: 'utility',
  distributionRole: 'fitting',
  portConnectivityFollow: false,
  // trap is anchored; dragging a connected run stretches the arm, not the trap

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    diameter: 2,
    pipeMaterial: 'pvc',
    armLengthM: 0,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true, portSnap: { systems: ['waste'] } },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
  },
  geometry: buildPipeTrapGeometry,
  geometryKey: (n) => JSON.stringify([n.diameter, n.pipeMaterial, n.armLengthM]),
  ports: getPipeTrapPorts,
  floorplan: buildPipeTrapFloorplan,
  presentation: {
    label: 'Trap',
    description: 'DWV P-trap — water seal on the waste line. The trap arm runs to the vent.',
    icon: { kind: 'url', src: '/icons/dwv-pipes.webp' },
    paletteSection: 'structure',
    paletteOrder: 98,
  },
  mcp: {
    description:
      'A DWV P-trap with inlet (up) and outlet (trap arm) ports. Position is level-local meters; rotation is yaw radians. armLengthM is the trap-arm developed length checked against IPC 909.1.',
  },
}

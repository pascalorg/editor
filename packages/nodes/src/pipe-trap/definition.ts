import type { NodeDefinition } from '@pascal-app/core'
import { buildPipeTrapFloorplan } from './floorplan'
import { buildPipeTrapGeometry } from './geometry'
import { pipeTrapParametrics } from './parametrics'
import { getPipeTrapPorts } from './ports'
import { PipeTrapNode } from './schema'

/**
 * DWV P-trap — the water-seal fitting on the waste line. Placed by its
 * own click tool; the pipe tool then draws the trap arm off the outlet.
 * Modeled explicitly so the IPC 909.1 trap-arm rule has a node to
 * validate.
 */
export const pipeTrapDefinition: NodeDefinition<typeof PipeTrapNode> = {
  kind: 'pipe-trap',
  schemaVersion: 1,
  schema: PipeTrapNode,
  category: 'utility',
  distributionRole: 'fitting',
  snapProfile: 'item',
  portConnectivityFollow: false, // trap is anchored; dragging a connected run stretches the arm, not the trap

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

  parametrics: pipeTrapParametrics,

  geometry: buildPipeTrapGeometry,
  geometryKey: (n) => JSON.stringify([n.diameter, n.pipeMaterial, n.armLengthM]),

  ports: getPipeTrapPorts,

  floorplan: buildPipeTrapFloorplan,

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place trap' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],

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

import type { NodeDefinition } from '@pascal-app/core'
import { buildElectricalDeviceFloorplan } from './floorplan'
import { buildElectricalDeviceGeometry } from './geometry'
import { electricalDeviceParametrics } from './parametrics'
import { ElectricalDeviceNode } from './schema'

/**
 * Point-placed electrical device — outlet, switch, luminaire, junction box,
 * or distribution panel. Uses a simple click-to-place tool with R/T rotation.
 * Phase 1: box-mesh geometry and labeled-circle floor-plan symbol.
 */
export const electricalDeviceDefinition: NodeDefinition<typeof ElectricalDeviceNode> = {
  kind: 'electrical-device',
  schemaVersion: 1,
  schema: ElectricalDeviceNode,
  category: 'utility',
  distributionRole: 'terminal',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    deviceType: 'outlet',
    mounting: 'wall',
    voltage: 127,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
  },

  parametrics: electricalDeviceParametrics,

  geometry: buildElectricalDeviceGeometry,
  geometryKey: (n) => JSON.stringify([n.deviceType, n.mounting, n.voltage]),

  ports: () => [],

  floorplan: buildElectricalDeviceFloorplan,

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place device' },
    { key: 'D', label: 'Cycle device type' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Electrical Device',
    description: 'Outlet, switch, luminaire, junction box, or distribution panel.',
    icon: { kind: 'iconify', name: 'lucide:plug' },
    paletteSection: 'structure',
    paletteOrder: 110,
  },

  mcp: {
    description:
      'A point-placed electrical device. deviceType: outlet | switch | light | junction-box | panel. Position is level-local meters; rotation is yaw radians. voltage: 127 (standard) | 220 (high-power).',
  },
}

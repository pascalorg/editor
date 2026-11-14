import type { NodeRenderDefinition } from '../definition-contributions'
import { buildHvacEquipmentFloorplan } from './floorplan'
import { buildHvacEquipmentGeometry } from './geometry'
import { getHvacEquipmentPorts } from './ports'
import { HvacEquipmentNode } from './schema'

export const hvacEquipmentRenderDefinition: NodeRenderDefinition<typeof HvacEquipmentNode> & {
  kind: 'hvac-equipment'
} = {
  kind: 'hvac-equipment',
  schemaVersion: 1,
  schema: HvacEquipmentNode,
  category: 'utility',
  distributionRole: 'equipment',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    equipmentType: 'furnace',
    width: 0.56,
    depth: 0.71,
    height: 1.1,
    supplyShape: 'round',
    returnShape: 'round',
    supplyDiameter: 8,
    returnDiameter: 8,
    supplyWidth: 12,
    supplyHeight: 8,
    returnWidth: 14,
    returnHeight: 8,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    floorPlaced: {
      footprint: (node) => {
        const n = node as HvacEquipmentNode
        return {
          dimensions: [n.width, n.height, n.depth],
          rotation: [0, n.rotation, 0],
        }
      },
    },
  },
  geometry: buildHvacEquipmentGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.equipmentType,
      n.width,
      n.depth,
      n.height,
      n.supplyShape,
      n.returnShape,
      n.supplyDiameter,
      n.returnDiameter,
      n.supplyWidth,
      n.supplyHeight,
      n.returnWidth,
      n.returnHeight,
    ]),
  ports: getHvacEquipmentPorts,
  floorplan: buildHvacEquipmentFloorplan,
  presentation: {
    label: 'HVAC Unit',
    description:
      'Furnace, air handler, or condenser — duct runs connect to its supply/return collars.',
    icon: { kind: 'url', src: '/icons/HVAC.webp' },
    paletteSection: 'structure',
    paletteOrder: 92,
  },
  mcp: {
    description:
      'HVAC equipment cabinet (furnace, air handler, or condenser). Furnaces and air handlers have supply/return duct ports; every unit also has a refrigerant service port that a lineset run connects to. Position is level-local meters; rotation is yaw radians.',
  },
}

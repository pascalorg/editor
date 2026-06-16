import type { NodePort } from '@pascal-app/core'
import { Vector3 } from 'three'
import { equivalentDiameterIn, ovalEquivalentDiameterIn } from '../duct-segment/geometry'
import type { HvacEquipmentNode } from './schema'

type CollarShape = 'round' | 'rect' | 'oval'

type LocalPort = {
  id: string
  position: Vector3
  direction: Vector3
  diameter: number
  system: 'supply' | 'return' | 'refrigerant'
  // Duct collars only — the cross-section the collar mesh and wall hole
  // take. `diameter` above is the area-equivalent round size the port
  // advertises so round runs mate at a sensible size. Refrigerant ports
  // are always round and omit these.
  shape?: CollarShape
  width?: number
  height?: number
}

/** Area-equivalent round diameter (inches) a shaped collar advertises. */
function collarDiameterIn(shape: CollarShape, diameter: number, width: number, height: number) {
  if (shape === 'rect') return equivalentDiameterIn(width, height)
  if (shape === 'oval') return ovalEquivalentDiameterIn(width, height)
  return diameter
}

/** Nominal suction-line OD (inches) the refrigerant service connection
 * advertises — matches the lineset kind's default suction diameter so a
 * lineset run mates cleanly onto the valve. */
const REFRIGERANT_PORT_DIAMETER_IN = 0.875

/**
 * Duct ports in the cabinet's LOCAL frame (origin at the base center,
 * before yaw / position). Matches a typical upflow furnace / vertical air
 * handler: supply plenum collar on top, return drop on the -X side near
 * the bottom third. Condensers carry no duct ports — their connection is
 * the refrigerant lineset (see `localRefrigerantPorts`).
 */
export function localEquipmentPorts(node: HvacEquipmentNode): LocalPort[] {
  if (node.equipmentType === 'condenser') return []
  return [
    {
      id: 'supply',
      position: new Vector3(0, node.height, 0),
      direction: new Vector3(0, 1, 0),
      diameter: collarDiameterIn(
        node.supplyShape,
        node.supplyDiameter,
        node.supplyWidth,
        node.supplyHeight,
      ),
      system: 'supply',
      shape: node.supplyShape,
      width: node.supplyWidth,
      height: node.supplyHeight,
    },
    {
      id: 'return',
      position: new Vector3(-node.width / 2, node.height * 0.35, 0),
      direction: new Vector3(-1, 0, 0),
      diameter: collarDiameterIn(
        node.returnShape,
        node.returnDiameter,
        node.returnWidth,
        node.returnHeight,
      ),
      system: 'return',
      shape: node.returnShape,
      width: node.returnWidth,
      height: node.returnHeight,
    },
  ]
}

/**
 * Refrigerant service connection in the cabinet's LOCAL frame — the point
 * a lineset run leaves from (condenser) or arrives at (indoor coil on a
 * furnace / air handler). Every equipment type exposes exactly one, on the
 * +X service-valve face: a condenser/air-handler near the bottom third, a
 * furnace near the top where the cased A-coil sits above the heat
 * exchanger.
 */
export function localRefrigerantPorts(node: HvacEquipmentNode): LocalPort[] {
  const y = node.equipmentType === 'furnace' ? node.height * 0.8 : node.height * 0.3
  return [
    {
      id: 'lineset',
      position: new Vector3(node.width / 2, y, 0),
      direction: new Vector3(1, 0, 0),
      diameter: REFRIGERANT_PORT_DIAMETER_IN,
      system: 'refrigerant',
    },
  ]
}

/** `def.ports` — duct + refrigerant ports transformed into level-local
 * space (yaw + position). */
export function getHvacEquipmentPorts(node: HvacEquipmentNode): NodePort[] {
  const offset = new Vector3(node.position[0], node.position[1], node.position[2])
  const local = [...localEquipmentPorts(node), ...localRefrigerantPorts(node)]
  return local.map((port) => {
    const position = port.position.clone().applyAxisAngle(new Vector3(0, 1, 0), node.rotation)
    position.add(offset)
    const direction = port.direction
      .clone()
      .applyAxisAngle(new Vector3(0, 1, 0), node.rotation)
      .normalize()
    return {
      id: port.id,
      position: [position.x, position.y, position.z] as const,
      direction: [direction.x, direction.y, direction.z] as const,
      diameter: port.diameter,
      system: port.system,
      shape: port.shape,
      width: port.width,
      height: port.height,
    }
  })
}

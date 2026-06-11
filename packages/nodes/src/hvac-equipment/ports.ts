import type { NodePort } from '@pascal-app/core'
import { Vector3 } from 'three'
import type { HvacEquipmentNode } from './schema'

type LocalPort = {
  id: string
  position: Vector3
  direction: Vector3
  diameter: number
  system: 'supply' | 'return'
}

/**
 * Ports in the cabinet's LOCAL frame (origin at the base center, before
 * yaw / position). Matches a typical upflow furnace / vertical air
 * handler: supply plenum collar on top, return drop on the -X side near
 * the bottom third. Condensers are the refrigerant side of a split
 * system — no duct ports.
 */
export function localEquipmentPorts(node: HvacEquipmentNode): LocalPort[] {
  if (node.equipmentType === 'condenser') return []
  return [
    {
      id: 'supply',
      position: new Vector3(0, node.height, 0),
      direction: new Vector3(0, 1, 0),
      diameter: node.supplyDiameter,
      system: 'supply',
    },
    {
      id: 'return',
      position: new Vector3(-node.width / 2, node.height * 0.35, 0),
      direction: new Vector3(-1, 0, 0),
      diameter: node.returnDiameter,
      system: 'return',
    },
  ]
}

/** `def.ports` — local ports transformed into level-local space (yaw + position). */
export function getHvacEquipmentPorts(node: HvacEquipmentNode): NodePort[] {
  const offset = new Vector3(node.position[0], node.position[1], node.position[2])
  return localEquipmentPorts(node).map((port) => {
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
    }
  })
}

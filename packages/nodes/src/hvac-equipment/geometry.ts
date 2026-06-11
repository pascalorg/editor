import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
} from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import { localEquipmentPorts } from './ports'
import type { HvacEquipmentNode } from './schema'

const RADIAL_SEGMENTS = 24

const CABINET_COLOR = '#b8bcc2'
const PANEL_COLOR = '#8d939b'
const CONDENSER_COLOR = '#9aa39c'
const FAN_COLOR = '#3f4549'

/**
 * Pure geometry builder for an HVAC equipment cabinet, in the node's
 * LOCAL frame (origin at base center) — `<ParametricNodeRenderer>`
 * applies `position` + yaw.
 *
 * Furnace / air handler: sheet-metal cabinet, inset front access panel,
 * supply collar stub on top and return collar on the -X side (matching
 * `localEquipmentPorts`). Condenser: squat cabinet with a fan ring and
 * hub on top.
 */
export function buildHvacEquipmentGeometry(node: HvacEquipmentNode): Group {
  const group = new Group()
  const isCondenser = node.equipmentType === 'condenser'

  const cabinetMaterial = new MeshStandardMaterial({
    color: isCondenser ? CONDENSER_COLOR : CABINET_COLOR,
    metalness: 0.55,
    roughness: 0.45,
  })

  const body = new Mesh(new BoxGeometry(node.width, node.height, node.depth), cabinetMaterial)
  body.name = 'equipment-body'
  body.position.set(0, node.height / 2, 0)
  group.add(body)

  if (isCondenser) {
    const fanMaterial = new MeshStandardMaterial({
      color: FAN_COLOR,
      metalness: 0.3,
      roughness: 0.7,
    })
    const ringRadius = Math.min(node.width, node.depth) * 0.36
    const ring = new Mesh(
      new TorusGeometry(ringRadius, ringRadius * 0.12, 10, RADIAL_SEGMENTS),
      fanMaterial,
    )
    ring.name = 'condenser-fan-ring'
    ring.rotation.x = Math.PI / 2
    ring.position.set(0, node.height + 0.01, 0)
    group.add(ring)
    const hub = new Mesh(
      new CylinderGeometry(ringRadius * 0.25, ringRadius * 0.25, 0.05, RADIAL_SEGMENTS),
      fanMaterial,
    )
    hub.name = 'condenser-fan-hub'
    hub.position.set(0, node.height + 0.01, 0)
    group.add(hub)
    return group
  }

  // Inset front access panel so the cabinet reads as a furnace, not a
  // featureless box. Front = +Z face.
  const panelMaterial = new MeshStandardMaterial({
    color: PANEL_COLOR,
    metalness: 0.5,
    roughness: 0.5,
  })
  const panel = new Mesh(
    new BoxGeometry(node.width * 0.78, node.height * 0.55, 0.015),
    panelMaterial,
  )
  panel.name = 'equipment-panel'
  panel.position.set(0, node.height * 0.38, node.depth / 2 + 0.002)
  group.add(panel)

  // Collar stubs at the ports so duct runs visually meet metal.
  const collarMaterial = new MeshStandardMaterial({
    color: '#c2c2c2',
    metalness: 0.6,
    roughness: 0.4,
  })
  const STUB_LENGTH = 0.12
  for (const port of localEquipmentPorts(node)) {
    const radius = (port.diameter * INCHES_TO_METERS) / 2
    const stub = new Mesh(
      new CylinderGeometry(radius, radius, STUB_LENGTH, RADIAL_SEGMENTS, 1, false),
      collarMaterial,
    )
    stub.name = `equipment-collar-${port.id}`
    stub.position.copy(port.position).addScaledVector(port.direction, -STUB_LENGTH / 2)
    stub.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), port.direction)
    group.add(stub)
  }

  return group
}

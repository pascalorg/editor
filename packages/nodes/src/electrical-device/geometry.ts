import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { ElectricalDeviceNode } from './schema'

const DEVICE_COLORS: Record<ElectricalDeviceNode['deviceType'], string> = {
  outlet: '#fbbf24',
  switch: '#94a3b8',
  light: '#fef08a',
  'junction-box': '#6b7280',
  panel: '#374151',
}

const DEVICE_SIZE_M: Record<
  ElectricalDeviceNode['deviceType'],
  [number, number, number]
> = {
  outlet: [0.07, 0.11, 0.04],
  switch: [0.07, 0.11, 0.03],
  light: [0.3, 0.06, 0.3],
  'junction-box': [0.1, 0.1, 0.1],
  panel: [0.4, 0.6, 0.1],
}

/**
 * Simple box-mesh geometry for electrical devices. The box represents the
 * face plate (outlet/switch), fixture (light), or enclosure (junction-box,
 * panel). Actual detailed geometry comes in a later phase.
 */
export function buildElectricalDeviceGeometry(node: ElectricalDeviceNode): Group {
  const group = new Group()
  const [w, h, d] = DEVICE_SIZE_M[node.deviceType]!
  const color = DEVICE_COLORS[node.deviceType]!

  const isMetal = node.deviceType === 'junction-box' || node.deviceType === 'panel'
  const material = new MeshStandardMaterial({
    color,
    metalness: isMetal ? 0.5 : 0.1,
    roughness: isMetal ? 0.4 : 0.6,
  })

  const mesh = new Mesh(new BoxGeometry(w, h, d), material)
  mesh.name = `electrical-device-body`

  // Mount offset: wall-mounted devices sit flush against an imaginary wall
  // surface; ceiling-mounted hang from above; floor-mounted sit on grade.
  const halfD = d / 2
  if (node.mounting === 'wall') {
    mesh.position.set(0, node.deviceType === 'panel' ? 0 : 1.2, halfD)
  } else if (node.mounting === 'ceiling') {
    mesh.position.set(0, -h / 2, 0)
    mesh.rotation.x = Math.PI / 2
  } else {
    mesh.position.set(0, h / 2, 0)
  }

  group.add(mesh)
  return group
}

export { INCHES_TO_METERS }
